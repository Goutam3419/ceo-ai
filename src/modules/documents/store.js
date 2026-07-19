/**
 * In-memory persistence for documents.
 *
 * Same swappable-store pattern as every other module's store.
 */
export class InMemoryDocumentStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').Document>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').Document} doc */
  save(doc) {
    this._records.set(doc.id, doc);
    return doc;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{taskId?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.taskId) all = all.filter((d) => d.taskId === filter.taskId);
    return all;
  }
}
