---
"@wagmi/core": patch
---

Fixed connection state bugs. Every fix only changes outcomes that previously threw or left `status`, `current` and `connections` disagreeing:

- A rejected `connect()` while only storage-restored connections exist no longer reports `connected`.
- `disconnect()` during `reconnect` no longer throws a `TypeError`, and `reconnect` no longer re-adds the disconnected connector. Other connectors are still restored.
- `reconnect` keeps a connection added by a concurrent `connect()`.
- Write actions during `reconnect` throw `ConnectorUnavailableReconnectingError` instead of a `TypeError`.
- Connector listeners can no longer be skipped or duplicated, including after a rejected `injected` `switchChain`.
- EIP-6963 announcements no longer re-run `setup()` on known wallets.
