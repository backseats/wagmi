---
"@wagmi/core": major
"wagmi": major
"@wagmi/vue": major
"@wagmi/solid": major
---

**Breaking:** connection state behaviour changes.

- `config.setState` corrects inconsistent input: a `current` with no matching connection moves to the first connection (or `null`), and `status: 'connected'` with no connections becomes `'disconnected'`. `revalidate` now moves `current` to a remaining connection instead of setting it to `null`.
- `disconnect()` clears state even when the wallet fails to disconnect, then rethrows the wallet's error. Previously it threw before changing state.
- Disconnecting a connection that isn't current keeps `current`. Previously `current` switched to the first remaining connection.
- `switchChain` with a connector restored from storage throws `ConnectorUnavailableReconnectingError` instead of `SwitchChainNotSupportedError`.
- `useConnectionEffect` (`useAccountEffect`) calls `onConnect` for wallet-initiated connects.
- `useConnectionEffect` calls `onDisconnect` when a restored session fails to reconnect. Apps that sign out in `onDisconnect` (e.g. RainbowKit's SIWE adapter) now sign out on a page load whose wallet is no longer authorized.
