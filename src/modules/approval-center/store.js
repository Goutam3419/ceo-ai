/**
 * In-memory persistence for approval requests.
 *
 * Deliberately isolated behind this small interface (save/getById/list)
 * so a real database-backed store can replace it later without changing
 * approvalCenter.js.
 */
export class InMemoryApprovalStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').ApprovalRequest>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').ApprovalRequest} request */
  save(request) {
    this._records.set(request.id, request);
    return request;
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
