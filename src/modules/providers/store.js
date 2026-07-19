/**
 * In-memory persistence for Providers Center. Two small stores, same
 * swappable pattern as every other module: providers themselves, and
 * the assignment history mapping a role to a provider over time.
 */
export class InMemoryProviderStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').Provider>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').Provider} provider */
  save(provider) {
    this._records.set(provider.id, provider);
    return provider;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{type?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.type) all = all.filter((p) => p.type === filter.type);
    return all;
  }
}

export class InMemoryProviderAssignmentStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').ProviderAssignment>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').ProviderAssignment} assignment */
  save(assignment) {
    this._records.set(assignment.id, assignment);
    return assignment;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{role?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.role) all = all.filter((a) => a.role === filter.role);
    return all;
  }
}
