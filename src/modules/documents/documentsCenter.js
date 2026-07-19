import { randomUUID } from "node:crypto";
import { EVENTS } from "../../shared/types.js";

/**
 * DocumentsCenter — real module.
 *
 * Same "real internal storage, not an external-provider boundary"
 * shape as Memory Center: `createDocument()` / `updateDocument()`
 * genuinely store content (in memory, for this process's lifetime).
 * Each update increments `version` and appends a history entry —
 * simple versioning, no diffing or branching.
 */
export class DocumentsCenter {
  /**
   * @param {{store: import('./store.js').InMemoryDocumentStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * @param {{title: string, content: string, requestedBy: string, taskId?: string}} input
   * @returns {import('../../shared/types.js').Document}
   */
  createDocument(input) {
    if (!input || !input.title || input.content === undefined || !input.requestedBy) {
      throw new Error("DocumentsCenter.createDocument requires: title, content, requestedBy");
    }

    const now = new Date().toISOString();
    /** @type {import('../../shared/types.js').Document} */
    const doc = {
      id: randomUUID(),
      title: input.title,
      content: input.content,
      version: 1,
      requestedBy: input.requestedBy,
      taskId: input.taskId ?? null,
      createdAt: now,
      updatedAt: now,
      history: [{ version: 1, by: input.requestedBy, at: now }],
    };

    this._store.save(doc);
    this._auditLog.record(input.requestedBy, "DOCUMENT_CREATED", {
      title: doc.title,
      version: doc.version,
      ...(doc.taskId ? { taskId: doc.taskId } : {}),
    });
    this._emit(EVENTS.DOCUMENT_CREATED, doc);

    return doc;
  }

  /**
   * @param {string} id
   * @param {{content: string, requestedBy: string}} input
   * @returns {import('../../shared/types.js').Document}
   */
  updateDocument(id, input) {
    if (!input || input.content === undefined || !input.requestedBy) {
      throw new Error("DocumentsCenter.updateDocument requires: content, requestedBy");
    }
    const doc = this._store.getById(id);
    if (!doc) {
      throw new Error(`DocumentsCenter.updateDocument: document not found: ${id}`);
    }

    doc.content = input.content;
    doc.version += 1;
    doc.updatedAt = new Date().toISOString();
    doc.history.push({ version: doc.version, by: input.requestedBy, at: doc.updatedAt });

    this._store.save(doc);
    this._auditLog.record(input.requestedBy, "DOCUMENT_UPDATED", {
      title: doc.title,
      version: doc.version,
      ...(doc.taskId ? { taskId: doc.taskId } : {}),
    });
    this._emit(EVENTS.DOCUMENT_UPDATED, doc);

    return doc;
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{taskId?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
