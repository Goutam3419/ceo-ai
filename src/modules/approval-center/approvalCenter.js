import { randomUUID } from "node:crypto";
import { APPROVAL_STATUS, EVENTS } from "../../shared/types.js";

/**
 * ApprovalCenter — first real module in the framework.
 *
 * Any high-risk action anywhere in the system must be represented as an
 * ApprovalRequest here and resolved (APPROVED/REJECTED) before the
 * requesting module is allowed to execute it. This module does not
 * execute actions itself — it only tracks approval state and hands
 * decisions back to whoever asked.
 *
 * Dependencies are injected so this stays testable and so the store /
 * audit log / event bus can be swapped later without touching this file.
 */
export class ApprovalCenter {
  /**
   * @param {{store: import('./store.js').InMemoryApprovalStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * Create a new approval request. Always starts PENDING.
   * @param {{title: string, description?: string, requestedBy: string, riskLevel: string, payload?: Object}} input
   * @returns {import('../../shared/types.js').ApprovalRequest}
   */
  createRequest(input) {
    if (!input || !input.title || !input.requestedBy || !input.riskLevel) {
      throw new Error(
        "ApprovalCenter.createRequest requires: title, requestedBy, riskLevel"
      );
    }

    const now = new Date().toISOString();
    /** @type {import('../../shared/types.js').ApprovalRequest} */
    const request = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? "",
      requestedBy: input.requestedBy,
      riskLevel: input.riskLevel,
      status: APPROVAL_STATUS.PENDING,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now,
      history: [
        {
          action: "CREATED",
          by: input.requestedBy,
          at: now,
        },
      ],
    };

    this._store.save(request);
    this._auditLog.record(input.requestedBy, "APPROVAL_REQUEST_CREATED", {
      requestId: request.id,
      title: request.title,
      riskLevel: request.riskLevel,
      ...this._causationDetails(request),
    });
    this._emit(EVENTS.APPROVAL_REQUESTED, request);

    return request;
  }

  /**
   * @param {string} id
   * @param {{by: string, note?: string}} actor
   * @returns {import('../../shared/types.js').ApprovalRequest}
   */
  approve(id, actor) {
    const request = this._requirePending(id);

    request.status = APPROVAL_STATUS.APPROVED;
    request.updatedAt = new Date().toISOString();
    request.history.push({
      action: "APPROVED",
      by: actor.by,
      at: request.updatedAt,
      note: actor.note,
    });

    this._store.save(request);
    this._auditLog.record(actor.by, "APPROVAL_REQUEST_APPROVED", {
      requestId: id,
      ...this._causationDetails(request),
    });
    this._emit(EVENTS.APPROVAL_APPROVED, request);

    return request;
  }

  /**
   * @param {string} id
   * @param {{by: string, note?: string}} actor
   * @returns {import('../../shared/types.js').ApprovalRequest}
   */
  reject(id, actor) {
    const request = this._requirePending(id);

    request.status = APPROVAL_STATUS.REJECTED;
    request.updatedAt = new Date().toISOString();
    request.history.push({
      action: "REJECTED",
      by: actor.by,
      at: request.updatedAt,
      note: actor.note,
    });

    this._store.save(request);
    this._auditLog.record(actor.by, "APPROVAL_REQUEST_REJECTED", {
      requestId: id,
      ...this._causationDetails(request),
    });
    this._emit(EVENTS.APPROVAL_REJECTED, request);

    return request;
  }

  /**
   * Edit a pending request's editable fields. Stays PENDING afterward —
   * an edit is not a decision, it just changes what's being decided on.
   * @param {string} id
   * @param {{by: string, changes: {title?: string, description?: string, payload?: Object}, note?: string}} actor
   * @returns {import('../../shared/types.js').ApprovalRequest}
   */
  edit(id, actor) {
    const request = this._requirePending(id);

    if (actor.changes?.title !== undefined) request.title = actor.changes.title;
    if (actor.changes?.description !== undefined)
      request.description = actor.changes.description;
    if (actor.changes?.payload !== undefined)
      request.payload = actor.changes.payload;

    request.updatedAt = new Date().toISOString();
    request.history.push({
      action: "EDITED",
      by: actor.by,
      at: request.updatedAt,
      note: actor.note,
    });

    this._store.save(request);
    this._auditLog.record(actor.by, "APPROVAL_REQUEST_EDITED", {
      requestId: id,
      ...this._causationDetails(request),
    });
    this._emit(EVENTS.APPROVAL_EDITED, request);

    return request;
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{status?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  /** @param {string} id */
  _requirePending(id) {
    const request = this._store.getById(id);
    if (!request) {
      throw new Error(`ApprovalRequest not found: ${id}`);
    }
    if (request.status !== APPROVAL_STATUS.PENDING) {
      throw new Error(
        `ApprovalRequest ${id} is ${request.status}, only PENDING requests can be approved/rejected/edited`
      );
    }
    return request;
  }

  /**
   * Pulls known causation-link fields out of a request's payload so
   * they land in audit details too. Currently just taskId — the one
   * gap that made task-level causation chains stop at Review Queue.
   * Deliberately narrow: does not change what Logs Center infers, only
   * adds one more id (when present) to what's already being recorded.
   * @param {import('../../shared/types.js').ApprovalRequest} request
   */
  _causationDetails(request) {
    return request.payload?.taskId ? { taskId: request.payload.taskId } : {};
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
