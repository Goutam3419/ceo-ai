/**
 * In-memory persistence for memory entries.
 *
 * Same swappable-store pattern as every other module's store: isolated
 * behind save/getById/list so a real store can replace it later
 * without touching memoryCenter.js. Adds getByKey() since entries are
 * upserted by key.
 */
export class InMemoryMemoryStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').MemoryEntry>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').MemoryEntry} entry */
  save(entry) {
    this._records.set(entry.id, entry);
    return entry;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {string} key */
  getByKey(key) {
    return [...this._records.values()].find((e) => e.key === key) ?? null;
  }

  /** @param {{taskId?: string, tag?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.taskId) all = all.filter((e) => e.taskId === filter.taskId);
    if (filter.tag) all = all.filter((e) => (e.tags || []).includes(filter.tag));
    return all;
  }
}
