import { CtoAgentBoundary } from "./ctoAgentBoundary.js";

export { CtoAgentBoundary, boundary } from "./ctoAgentBoundary.js";

/**
 * Convenience factory for wiring a CtoAgentBoundary with shared deps
 * the app shell owns.
 *
 * @param {{taskBoard: import('../task-board/taskBoard.js').TaskBoard, reviewQueue: import('../review-queue/reviewQueue.js').ReviewQueue, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createCtoAgent(deps) {
  return new CtoAgentBoundary(deps);
}
