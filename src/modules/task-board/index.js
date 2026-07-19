import { TaskBoard } from "./taskBoard.js";
import { InMemoryTaskStore } from "./store.js";

export { TaskBoard } from "./taskBoard.js";
export { InMemoryTaskStore } from "./store.js";

/**
 * Convenience factory for wiring a TaskBoard with default in-memory
 * store, given shared deps (auditLog/eventBus) the app shell owns.
 *
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createTaskBoard(deps) {
  return new TaskBoard({
    store: new InMemoryTaskStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "task-board",
  status: "REAL", // third fully implemented module
  implemented: [
    "createTask()",
    "updateStatus()",
    "assignOwner()",
    "getById()",
    "list()",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "automatic handoff to Review Queue (caller wires this explicitly)",
    "UI",
  ],
});
