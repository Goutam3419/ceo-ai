/**
 * In-memory persistence for review items.
 *
 * Same swappable-store pattern as approval-center/store.js: isolated
 * behind save/getById/list so a real DB-backed store can replace it
 * later without touching reviewQueue.js.
 */
export class InMemoryReviewStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').ReviewItem>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').ReviewItem} item */
  save(item) {
    this._records.set(item.id, item);
    return item;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{status?: string}} [filter] */
  list(filter = {}) {
    const all = [...this._records.values()];
    if (filter.status) {
      return all.filter((r) => r.status === filter.status);
    }
    return all;
  }
}
