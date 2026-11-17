import {
  getActivity,
  isLive,
  removeConnection,
  unlisten,
} from '../connection.js'
import type { Config, Connector } from '../createConfig.js'
import type { BaseErrorType, ErrorType } from '../errors/base.js'
import type {
  ConnectorNotConnectedErrorType,
  ConnectorNotFoundErrorType,
} from '../errors/config.js'
import type { ConnectorParameter } from '../types/properties.js'

export type DisconnectParameters = ConnectorParameter

export type DisconnectReturnType = void

export type DisconnectErrorType =
  | ConnectorNotFoundErrorType
  | ConnectorNotConnectedErrorType
  // base
  | BaseErrorType
  | ErrorType

/** https://wagmi.sh/core/api/actions/disconnect */
export async function disconnect(
  config: Config,
  parameters: DisconnectParameters = {},
): Promise<DisconnectReturnType> {
  let connector: Connector | undefined
  if (parameters.connector) connector = parameters.connector
  else {
    const { connections, current } = config.state
    connector = connections.get(current!)?.connector
  }
  const uid = connector?.uid
  // Stop an in-flight `reconnect` from restoring this connector afterwards
  const activity = getActivity(config)
  if (connector && activity.reconnecting)
    activity.disconnected.add(connector.id)

  // A connector restored from storage has no methods yet, so disconnect the
  // configured connector it stands for.
  if (connector && !isLive(connector))
    connector = config.connectors.find((x) => x.id === connector!.id)

  try {
    await connector?.disconnect()
  } finally {
    // The wallet can fail to disconnect (e.g. extension removed), but the
    // user asked to disconnect, so the connection is removed either way.
    if (connector) unlisten(config._internal.events, connector)
    config.setState((x) => removeConnection(x, uid))
  }

  // Set recent connector if exists
  {
    const current = config.state.current
    if (!current) return
    const connector = config.state.connections.get(current)?.connector
    if (!connector) return
    await config.storage?.setItem('recentConnectorId', connector.id)
  }
}
