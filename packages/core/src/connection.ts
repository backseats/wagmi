import type { Config, Connection, Connector, State } from './createConfig.js'

// Every write to the connection fields (`status`, `current`, `connections`)
// goes through the transitions below, and `normalize` runs on every write,
// so `status`, `current` and `connections` can't disagree.

/**
 * Connectors restored from storage are `{ id, name, type, uid }` only, with
 * no methods, until `reconnect` replaces them with the real connector.
 */
export function isLive(connector: Connector): boolean {
  return typeof connector.getProvider === 'function'
}

/** Enforces the invariants that must hold after every write. */
export function normalize<state extends State<any>>(state: state): state {
  let { current, status } = state
  const { connections } = state
  // `current` always points at a connection, if there is one
  if (!current || !connections.has(current))
    current = connections.keys().next().value ?? null
  // `connected` always has a connection
  if (status === 'connected' && !current) status = 'disconnected'
  if (current === state.current && status === state.status) return state
  return { ...state, current, status }
}

export function addConnection<state extends State<any>>(
  state: state,
  connection: Connection,
): state {
  const uid = connection.connector.uid
  return {
    ...state,
    connections: new Map(state.connections).set(uid, connection),
    current: uid,
    status: 'connected',
  }
}

export function removeConnection<state extends State<any>>(
  state: state,
  uid: string | undefined,
): state {
  const connections = new Map(state.connections)
  if (uid) connections.delete(uid)
  if (connections.size === 0)
    return { ...state, connections, current: null, status: 'disconnected' }
  // keep `current` if it's still connected, otherwise `normalize` picks the next one
  return { ...state, connections }
}

/** What runs while the store is being written, per config. */
type Activity = {
  /** `connect()` calls in flight */
  connecting: number
  /** Connector ids disconnected during a `reconnect`, which it must not restore */
  disconnected: Set<string>
  reconnecting: boolean
}
const activities = new WeakMap<Config, Activity>()
export function getActivity(config: Config): Activity {
  let activity = activities.get(config)
  if (!activity) {
    activity = { connecting: 0, disconnected: new Set(), reconnecting: false }
    activities.set(config, activity)
  }
  return activity
}

/**
 * Settles `status` once a `connect()` or `reconnect` finishes: `connected` if a
 * live connection exists, otherwise back to whatever is still in flight, or
 * `disconnected`. With `prune` (end of `reconnect`), connectors restored from
 * storage that were never reconnected are dropped.
 */
export function settle(config: Config, prune = false) {
  const activity = getActivity(config)
  // a `connect()` still in flight settles when it finishes
  if (activity.connecting) return
  config.setState((x) => {
    const live = [...x.connections].filter(([, connection]) =>
      isLive(connection.connector),
    )
    const connections =
      prune && live.length !== x.connections.size
        ? new Map(live)
        : x.connections
    if (live.length) return { ...x, connections, status: 'connected' }
    if (activity.reconnecting)
      return { ...x, status: x.current ? 'reconnecting' : 'connecting' }
    // a failed `connect()` leaves stored sessions for a later `reconnect`
    if (!prune) return { ...x, status: 'disconnected' }
    return { ...x, connections, current: null, status: 'disconnected' }
  })
}

type Events = Config['_internal']['events']

/**
 * A connected connector listens for `change` and `disconnect`; a disconnected
 * one listens for `connect`. Removing before adding keeps this idempotent, and
 * only touches wagmi's own handlers (connectors add their own listeners).
 */
export function listen(events: Events, connector: Connector) {
  const { emitter } = connector
  emitter.off('connect', events.connect)
  emitter.off('change', events.change)
  emitter.on('change', events.change)
  emitter.off('disconnect', events.disconnect)
  emitter.on('disconnect', events.disconnect)
}

export function unlisten(events: Events, connector: Connector) {
  const { emitter } = connector
  emitter.off('change', events.change)
  emitter.off('disconnect', events.disconnect)
  emitter.off('connect', events.connect)
  emitter.on('connect', events.connect)
}
