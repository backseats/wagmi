import { type GetConnectionReturnType, watchConnection } from '@wagmi/core'
import type { Compute, ConfigParameter } from '@wagmi/core/internal'
import { watchEffect } from 'vue'
import type { DeepMaybeRef } from '../types/ref.js'
import { deepUnref } from '../utils/cloneDeep.js'
import { useConfig } from './useConfig.js'

export type UseConnectionEffectParameters = Compute<
  DeepMaybeRef<
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
>

/** https://wagmi.sh/vue/api/composables/useConnectionEffect */
export function useConnectionEffect(
  parameters: UseConnectionEffectParameters = {},
) {
  const config = useConfig(parameters)

  watchEffect((onCleanup) => {
    const { onConnect, onDisconnect } = deepUnref(parameters)

    const unwatch = watchConnection(config, {
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

    onCleanup(() => unwatch())
  })
}
