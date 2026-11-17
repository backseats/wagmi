import { type GetConnectionReturnType, watchConnection } from '@wagmi/core'
import type { Compute, ConfigParameter } from '@wagmi/core/internal'
import type { Accessor } from 'solid-js'
import { createEffect, onCleanup } from 'solid-js'
import { useConfig } from './useConfig.js'

/** https://wagmi.sh/solid/api/primitives/useConnectionEffect */
export function useConnectionEffect(
  parameters: useConnectionEffect.Parameters = () => ({}),
) {
  const config = useConfig(parameters)

  createEffect(() => {
    const { onConnect, onDisconnect } = parameters()

    const unsubscribe = watchConnection(config(), {
      onChange(data, prevData) {
        if (
          data.status === 'connected' &&
          prevData.status !== 'connected' &&
          // a `connect()` while already connected (keeps today's behavior)
          !(prevData.status === 'connecting' && prevData.address)
        ) {
          const { address, addresses, chain, chainId, connector } = data
          const isReconnected = prevData.status === 'reconnecting'
          onConnect?.({
            address,
            addresses,
            chain,
            chainId,
            connector,
            isReconnected,
          })
        } else if (prevData.isConnected && data.status === 'disconnected')
          // includes a restored session failing to reconnect
          onDisconnect?.()
      },
    })
    onCleanup(() => unsubscribe())
  })
}

export namespace useConnectionEffect {
  export type Parameters = Accessor<SolidParameters>

  export type SolidParameters = Compute<
    {
      onConnect?(
        data: Compute<
          Pick<
            Extract<GetConnectionReturnType, { status: 'connected' }>,
            'address' | 'addresses' | 'chain' | 'chainId' | 'connector'
          > & {
            isReconnected: boolean
          }
        >,
      ): void
      onDisconnect?(): void
    } & ConfigParameter
  >
}
