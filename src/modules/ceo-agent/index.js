import { CeoAgentBoundary } from "./ceoAgentBoundary.js";

export { CeoAgentBoundary, boundary } from "./ceoAgentBoundary.js";

/**
 * Convenience factory for wiring a CeoAgentBoundary with shared deps
 * the app shell owns.
 *
 * @param {{approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, taskBoard: import('../task-board/taskBoard.js').TaskBoard, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createCeoAgent(deps) {
  return new CeoAgentBoundary(deps);
}
