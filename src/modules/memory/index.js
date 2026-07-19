import { MemoryCenter } from "./memoryCenter.js";
import { InMemoryMemoryStore } from "./store.js";

export { MemoryCenter } from "./memoryCenter.js";
export { InMemoryMemoryStore } from "./store.js";

/**
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createMemoryCenter(deps) {
  return new MemoryCenter({
    store: new InMemoryMemoryStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "memory",
  status: "REAL",
  implemented: [
    "remember() — upsert-by-key storage",
    "recall() — lookup by key",
    "getById() / list() — filter by taskId/tag",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "semantic/vector retrieval",
    "retention or expiry policy",
  ],
  note: "Real internal storage, not a boundary to an external provider — no 'intent' layer needed here.",
});
