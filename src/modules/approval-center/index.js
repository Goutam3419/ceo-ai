import { ApprovalCenter } from "./approvalCenter.js";
import { InMemoryApprovalStore } from "./store.js";
import { AuditLog } from "../logs/auditLog.js";

export { ApprovalCenter } from "./approvalCenter.js";
export { InMemoryApprovalStore } from "./store.js";

/**
 * Convenience factory for wiring an ApprovalCenter with default
 * (in-memory) dependencies. Callers who need shared deps (e.g. one
 * AuditLog shared across modules, one EventBus for the whole app)
 * should construct ApprovalCenter directly instead of using this.
 *
 * @param {{eventBus?: import('../../shared/eventBus.js').EventBus, auditLog?: AuditLog}} [opts]
 */
export function createApprovalCenter(opts = {}) {
  return new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: opts.auditLog ?? new AuditLog(),
    eventBus: opts.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "approval-center",
  status: "REAL", // first fully implemented module
  implemented: [
    "createRequest()",
    "approve()",
    "reject()",
    "edit()",
    "getById()",
    "list()",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "multi-approver / quorum rules",
    "expiry / timeout policy",
    "UI",
  ],
});
