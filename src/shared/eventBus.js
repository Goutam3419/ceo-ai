/**
 * Minimal synchronous event bus.
 * This is the skeleton for framework-wide state/event flow.
 * Modules should communicate side effects (audit logging, notifications,
 * future websocket push, etc.) by emitting/subscribing here instead of
 * calling each other directly wherever avoidable.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
  }

  /**
   * @param {string} eventName
   * @param {(payload: any) => void} handler
   */
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, []);
    }
    this._listeners.get(eventName).push(handler);
  }

  /**
   * @param {string} eventName
   * @param {any} payload
   */
  emit(eventName, payload) {
    const handlers = this._listeners.get(eventName) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }
}
