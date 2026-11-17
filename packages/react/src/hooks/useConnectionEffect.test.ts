import { mock } from '@wagmi/connectors'
import { connect, createConfig, disconnect, http, reconnect } from '@wagmi/core'
import { accounts, chain, config } from '@wagmi/test'
import { createWrapper, renderHook } from '@wagmi/test/react'
import { createElement, Fragment } from 'react'
import { expect, test, vi } from 'vitest'

import { WagmiProvider } from '../context.js'
import { useConnect } from './useConnect.js'
import { useConnectionEffect } from './useConnectionEffect.js'
import { useConnectors } from './useConnectors.js'
import { useDisconnect } from './useDisconnect.js'

test('parameters: config', async () => {
  const { result } = await renderHook(() => useConnectionEffect({ config }), {
    wrapper: ({ children }) => createElement(Fragment, { children }),
  })
  expect(result.current).toBeUndefined()
})

test('behavior: connect and disconnect called once', async () => {
  const onConnect = vi.fn()
  const onDisconnect = vi.fn()

  const { result } = await renderHook(() => ({
    useConnectionEffect: useConnectionEffect({ onConnect, onDisconnect }),
    useConnect: useConnect(),
    useConnectors: useConnectors(),
    useDisconnect: useDisconnect(),
  }))

  result.current.useConnect.mutate({
    connector: result.current.useConnectors[0]!,
  })
  await vi.waitFor(() =>
    expect(result.current.useConnect.isSuccess).toBeTruthy(),
  )

  result.current.useConnect.mutate({
    connector: result.current.useConnectors[0]!,
  })
  await vi.waitFor(() =>
    expect(result.current.useConnect.isSuccess).toBeTruthy(),
  )

  result.current.useDisconnect.mutate()
  await vi.waitFor(() =>
    expect(result.current.useDisconnect.isSuccess).toBeTruthy(),
  )
  result.current.useDisconnect.mutate()
  await vi.waitFor(() =>
    expect(result.current.useDisconnect.isSuccess).toBeTruthy(),
  )

  expect(onConnect).toBeCalledTimes(1)
  expect(onDisconnect).toBeCalledTimes(1)
})

test('behavior: connect called on reconnect', async () => {
  const config = createConfig({
    chains: [chain.mainnet],
    connectors: [
      mock({
        accounts,
        features: { reconnect: true },
      }),
    ],
    transports: { [chain.mainnet.id]: http() },
  })

  await connect(config, { connector: config.connectors[0]! })
  const onConnect = vi.fn((data) => {
    expect(data.isReconnected).toBeTruthy()
  })

  renderHook(() => useConnectionEffect({ onConnect }), {
    wrapper: createWrapper(WagmiProvider, { config, reconnectOnMount: true }),
  })

  await vi.waitFor(() => expect(onConnect).toBeCalledTimes(1), {
    timeout: 10_000,
  })

  await disconnect(config)
})

test('behavior: connect called on wallet-initiated connect', async () => {
  const config = createConfig({
    chains: [chain.mainnet],
    connectors: [mock({ accounts })],
    storage: null,
    transports: { [chain.mainnet.id]: http() },
  })
  const onConnect = vi.fn()
  await renderHook(() => useConnectionEffect({ config, onConnect }))

  const [connector] = config.connectors
  connector!.emitter.emit('connect', { accounts, chainId: chain.mainnet.id })

  await vi.waitFor(() => expect(onConnect).toBeCalledTimes(1))
  expect(onConnect.mock.calls[0]![0].isReconnected).toBe(false)
  await disconnect(config)
})

test('behavior: disconnect called when a restored session fails to reconnect', async () => {
  const config = createConfig({
    chains: [chain.mainnet],
    connectors: [mock({ accounts })], // not authorized, so it won't reconnect
    storage: null,
    transports: { [chain.mainnet.id]: http() },
  })
  const { id, name, type } = config.connectors[0]!
  config.setState((x) => ({
    ...x,
    connections: new Map([
      [
        'stored',
        {
          accounts,
          chainId: chain.mainnet.id,
          connector: { id, name, type, uid: 'stored' } as any,
        },
      ],
    ]),
    current: 'stored',
    status: 'reconnecting',
  }))
  const onDisconnect = vi.fn()
  await renderHook(() => useConnectionEffect({ config, onDisconnect }))

  await reconnect(config)
  expect(config.state.status).toBe('disconnected')
  await vi.waitFor(() => expect(onDisconnect).toBeCalledTimes(1))
})
