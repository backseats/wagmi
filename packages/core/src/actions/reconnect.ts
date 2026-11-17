import type { Address } from 'viem'

import { getActivity, isLive, listen, settle } from '../connection.js'
import type { CreateConnectorFn } from '../connectors/createConnector.js'
import type { Config, Connection, Connector } from '../createConfig.js'
import type { ErrorType } from '../errors/base.js'
import type { Compute } from '../types/utils.js'

export type ReconnectParameters = {
  /** Connectors to attempt reconnect with */
  connectors?: readonly (CreateConnectorFn | Connector)[] | undefined
}

export type ReconnectReturnType = Compute<Connection>[]

export type ReconnectErrorType = ErrorType

/** https://wagmi.sh/core/api/actions/reconnect */
export async function reconnect(
  config: Config,
  parameters: ReconnectParameters = {},
): Promise<ReconnectReturnType> {
  const activity = getActivity(config)
  // If already reconnecting, do nothing
  if (activity.reconnecting) return []
  activity.reconnecting = true
  activity.disconnected.clear()
  // Disconnected while this reconnect was in flight
  const disconnected = (connector: Connector) =>
    activity.disconnected.has(connector.id)

  try {
    // A `connect()` in flight owns `status` until it settles
    if (!activity.connecting)
      config.setState((x) => ({
        ...x,
        status: x.current ? 'reconnecting' : 'connecting',
      }))

    const connectors: Connector[] = []
    if (parameters.connectors?.length) {
      for (const connector_ of parameters.connectors) {
        let connector: Connector
        // "Register" connector if not already created
        if (typeof connector_ === 'function')
          connector = config._internal.connectors.setup(connector_)
        else connector = connector_
        connectors.push(connector)
      }
    } else connectors.push(...config.connectors)

    // Try recently-used connectors first
    let recentConnectorId: string | null | undefined
    try {
      recentConnectorId = await config.storage?.getItem('recentConnectorId')
    } catch {}
    const scores: Record<string, number> = {}
    for (const [, connection] of config.state.connections) {
      scores[connection.connector.id] = 1
    }
    if (recentConnectorId) scores[recentConnectorId] = 0
    const sorted =
      Object.keys(scores).length > 0
        ? // .toSorted()
          [...connectors].sort(
            (a, b) => (scores[a.id] ?? 10) - (scores[b.id] ?? 10),
          )
        : connectors

    // Iterate through each connector and try to connect
    let connected = false
    const connections: Connection[] = []
    const providers: unknown[] = []
    // Live connections that aren't restored below are no longer authorized
    const stale = new Set(
      [...config.state.connections]
        .filter(([, c]) => isLive(c.connector))
        .map(([uid]) => uid),
    )

    for (const connector of sorted) {
      if (disconnected(connector)) continue
      const provider = await connector.getProvider().catch(() => undefined)
      if (!provider) continue

      // If we already have an instance of this connector's provider,
      // then we have already checked it (ie. injected connectors can
      // share the same `window.ethereum` instance, so we don't want to
      // connect to it again).
      if (providers.some((x) => x === provider)) continue

      const isAuthorized = await connector.isAuthorized().catch(() => false)
      if (!isAuthorized) continue

      const data = await connector
        .connect({ isReconnecting: true })
        .catch(() => null)
      if (!data) continue
      if (disconnected(connector)) continue
      stale.delete(connector.uid)

      listen(config._internal.events, connector)

      config.setState((x) => {
        // The first restored connection replaces the ones restored from
        // storage, but keeps any a concurrent `connect()` added.
        const connections = new Map(
          connected
            ? x.connections
            : [...x.connections].filter(
                ([uid, c]) => isLive(c.connector) && !stale.has(uid),
              ),
        ).set(connector.uid, {
          accounts: data.accounts as readonly [Address, ...Address[]],
          chainId: data.chainId,
          connector,
        })
        return {
          ...x,
          current:
            x.current && connections.has(x.current) ? x.current : connector.uid,
          connections,
        }
      })
      connections.push({
        accounts: data.accounts as readonly [Address, ...Address[]],
        chainId: data.chainId,
        connector,
      })
      providers.push(provider)
      connected = true
    }

    if (stale.size)
      config.setState((x) => ({
        ...x,
        connections: new Map(
          [...x.connections].filter(([uid]) => !stale.has(uid)),
        ),
      }))

    return connections
  } finally {
    activity.reconnecting = false
    activity.disconnected.clear()
    settle(config, true)
  }
}
