import { randomUUID } from "node:crypto";

/**
 * AuditLog - MINIMAL implementation.
 *
 * This is not the full Logs Center module. It exists only because the
 * Approval Center milestone requires a working audit-log hook to record
 * approve/reject/edit actions. Storage, filtering, retention, and export
 * features belong to the real Logs Center module (future milestone).
 */
export class AuditLog {
  constructor() {
    /** @type {import('../../shared/types.js').AuditLogEntry[]} */
    this._entries = [];
  }

  /**
   * @param {string} actor - role from ROLES
   * @param {string} action
   * @param {Object} [details]
   * @returns {import('../../shared/types.js').AuditLogEntry}
   */
  record(actor, action, details = {}) {
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      details,
    };
    this._entries.push(entry);
    return entry;
  }

  /** @returns {import('../../shared/types.js').AuditLogEntry[]} */
  list() {
    return [...this._entries];
  }
}
