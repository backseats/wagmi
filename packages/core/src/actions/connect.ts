import type {
  Address,
  ResourceUnavailableRpcErrorType,
  UserRejectedRequestErrorType,
} from 'viem'

import { addConnection, getActivity, listen, settle } from '../connection.js'
import type { CreateConnectorFn } from '../connectors/createConnector.js'
import type { Config, Connector } from '../createConfig.js'
import type { BaseErrorType, ErrorType } from '../errors/base.js'
import {
  ConnectorAlreadyConnectedError,
  type ConnectorAlreadyConnectedErrorType,
} from '../errors/config.js'
import type { ChainIdParameter } from '../types/properties.js'
import type { Compute } from '../types/utils.js'

export type ConnectParameters<
  config extends Config = Config,
  connector extends Connector | CreateConnectorFn =
    | Connector
    | CreateConnectorFn,
  withCapabilities extends boolean = false,
  ///
  parameters extends unknown | undefined =
    | (connector extends CreateConnectorFn
        ? Omit<
            NonNullable<Parameters<ReturnType<connector>['connect']>[0]>,
            'isReconnecting'
          >
        : never)
    | (connector extends Connector
        ? Omit<
            NonNullable<Parameters<connector['connect']>[0]>,
            'isReconnecting'
          >
        : never),
> = Compute<
  ChainIdParameter<config> & {
    connector: connector | CreateConnectorFn
    withCapabilities?: withCapabilities | boolean | undefined
  }
> &
  parameters

export type ConnectReturnType<
  config extends Config = Config,
  connector extends Connector | CreateConnectorFn =
    | Connector
    | CreateConnectorFn,
  withCapabilities extends boolean = false,
  ///
  capabilities extends unknown | undefined =
    | (connector extends CreateConnectorFn
        ? Awaited<
            ReturnType<ReturnType<connector>['connect']>
          >['accounts'] extends
            | readonly Address[]
            | readonly {
                capabilities: infer capabilities
              }[]
          ? capabilities
          : Record<string, unknown>
        : never)
    | (connector extends Connector
        ? Awaited<ReturnType<connector['connect']>>['accounts'] extends
            | readonly Address[]
            | readonly {
                capabilities: infer capabilities
              }[]
          ? capabilities
          : Record<string, unknown>
        : never),
> = {
  accounts: withCapabilities extends true
    ? readonly [
        { address: Address; capabilities: capabilities },
        ...{ address: Address; capabilities: capabilities }[],
      ]
    : readonly [Address, ...Address[]]
  chainId:
    | config['chains'][number]['id']
    | (number extends config['chains'][number]['id'] ? number : number & {})
}

export type ConnectErrorType =
  | ConnectorAlreadyConnectedErrorType
  // connector.connect()
  | UserRejectedRequestErrorType
  | ResourceUnavailableRpcErrorType
  // base
  | BaseErrorType
  | ErrorType

/** https://wagmi.sh/core/api/actions/connect */
export async function connect<
  config extends Config,
  connector extends Connector | CreateConnectorFn,
  withCapabilities extends boolean = false,
>(
  config: config,
  parameters: ConnectParameters<config, connector, withCapabilities>,
): Promise<ConnectReturnType<config, connector, withCapabilities>> {
  // "Register" connector if not already created
  let connector: Connector
  if (typeof parameters.connector === 'function') {
    connector = config._internal.connectors.setup(parameters.connector)
  } else connector = parameters.connector

  // Check if connector is already connected
  if (connector.uid === config.state.current)
    throw new ConnectorAlreadyConnectedError()

  const activity = getActivity(config)
  activity.connecting++
  let connected = false
  try {
    config.setState((x) => ({ ...x, status: 'connecting' }))
    connector.emitter.emit('message', { type: 'connecting' })

    const { connector: _, ...rest } = parameters
    const data = await connector.connect(rest)

    listen(config._internal.events, connector)

    await config.storage?.setItem('recentConnectorId', connector.id)
    config.setState((x) =>
      addConnection(x, {
        accounts: (rest.withCapabilities
          ? data.accounts.map((account) =>
              typeof account === 'object' ? account.address : account,
            )
          : data.accounts) as readonly [Address, ...Address[]],
        chainId: data.chainId,
        connector: connector,
      }),
    )
    connected = true

    return {
      // TODO(v3): Remove `withCapabilities: true` default behavior so remove compat marshalling
      // Workaround so downstream connectors work with `withCapabilities` without any changes required
      accounts: (rest.withCapabilities
        ? data.accounts.map((address) =>
            typeof address === 'object'
              ? address
              : { address, capabilities: {} },
          )
        : data.accounts) as never,
      chainId: data.chainId,
    } as never
  } finally {
    activity.connecting--
    // Keep existing connections connected in case of error
    if (!connected) settle(config)
  }
}
