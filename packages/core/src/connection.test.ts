import { accounts, mainnet } from '@wagmi/test'
import { http } from 'viem'
import { expect, test, vi } from 'vitest'

import { connect } from './actions/connect.js'
import { disconnect } from './actions/disconnect.js'
import { getConnection } from './actions/getConnection.js'
import { getConnectorClient } from './actions/getConnectorClient.js'
import { reconnect } from './actions/reconnect.js'
import { switchChain } from './actions/switchChain.js'
import {
  type CreateConnectorFn,
  createConnector,
} from './connectors/createConnector.js'
import { mock } from './connectors/mock.js'
import { type Config, type Connector, createConfig } from './createConfig.js'

function createTestConfig(connectors: CreateConnectorFn[]) {
  return createConfig({
    chains: [mainnet],
    connectors,
    multiInjectedProviderDiscovery: false,
    storage: null,
    transports: { [mainnet.id]: http() },
  })
}

/** Puts `connector` in state the way storage restores it: no methods, old uid. */
function restoreFromStorage(config: Config, connector: Connector) {
  const { id, name, type } = connector
  const stored = { id, name, type, uid: 'stored' } as Connector
  config.setState((x) => ({
    ...x,
    connections: new Map([
      ['stored', { accounts, chainId: mainnet.id, connector: stored }],
    ]),
    current: 'stored',
  }))
}

/** An authorized connector whose SDK is still loading until `release()`. */
function createPendingConnector(id = 'pending') {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const connectorFn = createConnector<any>((config) => {
    const base = mock({
      accounts,
      features: { defaultConnected: true, reconnect: true },
    })(config)
    return {
      ...base,
      id,
      name: id,
      async getProvider() {
        await pending
        return base.getProvider()
      },
    }
  })
  return { connectorFn, release }
}

test('invariant: `current` always points at a connection', () => {
  const config = createTestConfig([mock({ accounts })])
  config.setState((x) => ({ ...x, current: 'missing', status: 'connected' }))
  expect(config.state.current).toBeNull()
  expect(config.state.status).toBe('disconnected')
})

test('connect: rejected with only stored connections is not connected', async () => {
  const config = createTestConfig([
    mock({ accounts, features: { connectError: true } }),
  ])
  const [connector] = config.connectors
  restoreFromStorage(config, connector!)

  await expect(connect(config, { connector: connector! })).rejects.toThrow()
  expect(config.state.status).toBe('disconnected')
  expect(getConnection(config).isConnected).toBe(false)
  // the stored session is kept for a later `reconnect`, as before
  expect(config.state.connections.size).toBe(1)
})

test('reconnect: disconnect while restoring wins', async () => {
  const { connectorFn, release } = createPendingConnector()
  const config = createTestConfig([connectorFn])
  const [connector] = config.connectors
  restoreFromStorage(config, connector!)

  const promise = reconnect(config)
  expect(config.state.status).toBe('reconnecting')
  // the stored connector has no methods, so the configured one is disconnected
  await disconnect(config)

  release()
  await promise
  expect(config.state.status).toBe('disconnected')
  expect(config.state.connections.size).toBe(0)
})

test('reconnect: keeps a connection a concurrent connect() added', async () => {
  const { connectorFn, release } = createPendingConnector()
  const config = createTestConfig([connectorFn, mock({ accounts })])
  const [pending, other] = config.connectors
  restoreFromStorage(config, pending!)

  const promise = reconnect(config)
  await connect(config, { connector: other! })
  expect(config.state.status).toBe('connected')

  release()
  await promise
  expect(config.state.current).toBe(other!.uid)
  expect([...config.state.connections.keys()].sort()).toEqual(
    [other!.uid, pending!.uid].sort(),
  )
  expect(config.state.status).toBe('connected')
})

test('getConnectorClient: stored connector while reconnecting', async () => {
  const config = createTestConfig([mock({ accounts })])
  restoreFromStorage(config, config.connectors[0]!)
  config.setState((x) => ({ ...x, status: 'reconnecting' }))

  await expect(getConnectorClient(config)).rejects.toThrow(
    'unavailable while reconnecting',
  )
})

test('disconnect: wallet failing to disconnect still disconnects', async () => {
  const config = createTestConfig([mock({ accounts })])
  const [connector] = config.connectors
  await connect(config, { connector: connector! })
  vi.spyOn(connector!, 'disconnect').mockRejectedValueOnce(
    new Error('extension removed'),
  )

  await expect(disconnect(config)).rejects.toThrow('extension removed')
  expect(config.state.status).toBe('disconnected')
  expect(config.state.connections.size).toBe(0)
})

test('listeners: a connector-added change listener does not stop syncing', () => {
  const config = createTestConfig([mock({ accounts })])
  const [connector] = config.connectors
  // e.g. left behind by a rejected `switchChain`
  connector!.emitter.on('change', () => {})

  // wallet-initiated connect
  connector!.emitter.emit('connect', { accounts, chainId: mainnet.id })
  expect(config.state.status).toBe('connected')

  connector!.emitter.emit('change', { chainId: 10 })
  expect(config.state.connections.get(connector!.uid)?.chainId).toBe(10)
})

function storeConnections(config: Config, connectors: Connector[]) {
  config.setState((x) => ({
    ...x,
    connections: new Map(
      connectors.map(({ id, name, type }, i) => [
        `stored${i}`,
        {
          accounts,
          chainId: mainnet.id,
          connector: { id, name, type, uid: `stored${i}` } as Connector,
        },
      ]),
    ),
    current: 'stored0',
  }))
}

test('reconnect: disconnecting one stored wallet still restores the others', async () => {
  const a = createPendingConnector('a')
  const b = createPendingConnector('b')
  const config = createTestConfig([a.connectorFn, b.connectorFn])
  const [connectorA, connectorB] = config.connectors
  storeConnections(config, [connectorA!, connectorB!])

  const promise = reconnect(config)
  await disconnect(config, {
    connector: config.state.connections.get('stored1')!.connector,
  })
  a.release()
  b.release()
  await promise

  expect(config.state.status).toBe('connected')
  expect([...config.state.connections.keys()]).toEqual([connectorA!.uid])
})

test('reconnect: disconnect() with nothing connected does not stop it', async () => {
  const { connectorFn, release } = createPendingConnector()
  const config = createTestConfig([connectorFn])

  const promise = reconnect(config)
  await disconnect(config)
  release()
  await promise

  expect(config.state.status).toBe('connected')
  expect(config.state.current).toBe(config.connectors[0]!.uid)
})

test('reconnect: drops a live connection that is no longer authorized', async () => {
  // `reconnect: false` makes `isAuthorized` return false
  const config = createTestConfig([mock({ accounts })])
  await connect(config, { connector: config.connectors[0]! })

  await reconnect(config)
  expect(config.state.status).toBe('disconnected')
  expect(config.state.connections.size).toBe(0)
})

test('reconnect: a failed connect() in the meantime goes back to reconnecting', async () => {
  const { connectorFn, release } = createPendingConnector()
  const config = createTestConfig([
    connectorFn,
    mock({ accounts, features: { connectError: true } }),
  ])
  const [pending, failing] = config.connectors
  restoreFromStorage(config, pending!)

  const promise = reconnect(config)
  await expect(connect(config, { connector: failing! })).rejects.toThrow()
  expect(config.state.status).toBe('reconnecting')

  release()
  await promise
  expect(config.state.status).toBe('connected')
  expect(config.state.current).toBe(pending!.uid)
})

test('switchChain: stored connector while reconnecting', async () => {
  const config = createTestConfig([mock({ accounts })])
  restoreFromStorage(config, config.connectors[0]!)
  config.setState((x) => ({ ...x, status: 'reconnecting' }))

  await expect(switchChain(config, { chainId: mainnet.id })).rejects.toThrow(
    'unavailable while reconnecting',
  )
})

test('disconnect: removing another connection keeps the current one', async () => {
  const config = createTestConfig([
    mock({ accounts }),
    mock({ accounts }),
    mock({ accounts }),
  ])
  const [a, b, c] = config.connectors
  await connect(config, { connector: a! })
  await connect(config, { connector: b! })
  await connect(config, { connector: c! })

  await disconnect(config, { connector: b! })
  expect(config.state.current).toBe(c!.uid)
  expect(config.state.status).toBe('connected')
})
