/**
 * In-memory persistence for tasks.
 *
 * Same swappable-store pattern as approval-center/store.js and
 * review-queue/store.js: isolated behind save/getById/list so a real
 * DB-backed store can replace it later without touching taskBoard.js.
 */
export class InMemoryTaskStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').Task>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').Task} task */
  save(task) {
    this._records.set(task.id, task);
    return task;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{status?: string, owner?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.status) {
      all = all.filter((t) => t.status === filter.status);
    }
    if (filter.owner) {
      all = all.filter((t) => t.owner === filter.owner);
    }
    return all;
  }
}
