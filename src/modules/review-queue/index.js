import { ReviewQueue } from "./reviewQueue.js";
import { InMemoryReviewStore } from "./store.js";

export { ReviewQueue } from "./reviewQueue.js";
export { InMemoryReviewStore } from "./store.js";

/**
 * Convenience factory for wiring a ReviewQueue with default in-memory
 * store, given shared deps (auditLog/eventBus/approvalCenter) that the
 * app shell owns. approvalCenter is required — escalation has nowhere
 * to go without it.
 *
 * @param {{approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createReviewQueue(deps) {
  return new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog: deps.auditLog,
    approvalCenter: deps.approvalCenter,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "review-queue",
  status: "REAL", // second fully implemented module
  implemented: [
    "submit()",
    "markReviewed()",
    "escalateToApproval() — creates a linked Approval Center request",
    "getById()",
    "list()",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "reviewer role enforcement",
    "UI",
  ],
});
