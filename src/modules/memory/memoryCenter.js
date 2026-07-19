import { randomUUID } from "node:crypto";
import { EVENTS } from "../../shared/types.js";

/**
 * MemoryCenter — real module.
 *
 * Unlike GitHub Center / Deployment Center, this is not a boundary to
 * an external provider — it's plain internal key/value storage, so
 * there's no "intent" layer here: `remember()` genuinely stores the
 * value (in memory, for this process's lifetime — no external
 * persistence, same limitation every other module has).
 *
 * `remember()` upserts by key: calling it again with the same key
 * updates the existing entry rather than creating a duplicate.
 */
export class MemoryCenter {
  /**
   * @param {{store: import('./store.js').InMemoryMemoryStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * Store (or update) a fact under a key.
   * @param {{key: string, value: *, requestedBy: string, taskId?: string, tags?: string[]}} input
   * @returns {import('../../shared/types.js').MemoryEntry}
   */
  remember(input) {
    if (!input || !input.key || input.value === undefined || !input.requestedBy) {
      throw new Error("MemoryCenter.remember requires: key, value, requestedBy");
    }

    const existing = this._store.getByKey(input.key);
    const now = new Date().toISOString();
    /** @type {import('../../shared/types.js').MemoryEntry} */
    const entry = existing
      ? {
          ...existing,
          value: input.value,
          taskId: input.taskId ?? existing.taskId,
          tags: input.tags ?? existing.tags,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          key: input.key,
          value: input.value,
          requestedBy: input.requestedBy,
          taskId: input.taskId ?? null,
          tags: input.tags ?? [],
          createdAt: now,
          updatedAt: now,
        };

    this._store.save(entry);
    this._auditLog.record(input.requestedBy, "MEMORY_ENTRY_STORED", {
      key: entry.key,
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
    });
    this._emit(EVENTS.MEMORY_ENTRY_STORED, entry);

    return entry;
  }

  /** @param {string} key */
  recall(key) {
    return this._store.getByKey(key);
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{taskId?: string, tag?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
