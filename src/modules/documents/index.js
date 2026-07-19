import { DocumentsCenter } from "./documentsCenter.js";
import { InMemoryDocumentStore } from "./store.js";

export { DocumentsCenter } from "./documentsCenter.js";
export { InMemoryDocumentStore } from "./store.js";

/**
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createDocumentsCenter(deps) {
  return new DocumentsCenter({
    store: new InMemoryDocumentStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "documents",
  status: "REAL",
  implemented: [
    "createDocument()",
    "updateDocument() — increments version, appends history",
    "getById() / list() — filter by taskId",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "diffing / branching",
    "file uploads / binary content",
  ],
  note: "Real internal storage, not a boundary to an external provider — no 'intent' layer needed here.",
});
