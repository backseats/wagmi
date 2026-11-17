import type { Config, Connection, Connector, State } from './createConfig.js'

// Every write to the connection fields (`status`, `current`, `connections`)
// goes through the transitions below, so they can't disagree.

/**
 * Connectors restored from storage are `{ id, name, type, uid }` only, with
 * no methods, until `reconnect` replaces them with the real connector.
 */
export function isLive(connector: Connector): boolean {
  return typeof connector.getProvider === 'function'
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
  // switch over to another connection
  const next = connections.keys().next().value
  if (!next)
    return { ...state, connections, current: null, status: 'disconnected' }
  return { ...state, connections, current: next }
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
