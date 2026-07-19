import { randomUUID } from "node:crypto";
import { REVIEW_STATUS, EVENTS } from "../../shared/types.js";

/**
 * ReviewQueue — second real module in the framework.
 *
 * Sits between CTO Agent work and Founder Approval, per the workflow:
 * Founder -> CEO Agent -> CTO Agent -> GitHub/Deploy -> CEO Review -> Founder Approval -> Final Action
 *
 * CTO Agent (or any submitter) puts a completed unit of work here as a
 * ReviewItem. A CEO-level actor then either:
 *   - marks it REVIEWED directly (accepted, no founder approval needed), or
 *   - escalates it, which creates a real ApprovalRequest in Approval
 *     Center and marks the item ESCALATED, linking the two records.
 *
 * ReviewQueue never touches sensitive actions itself — escalation only
 * ever produces an Approval Center request, exactly like CEO Agent's
 * requestApproval(). It reuses the same create/guard/audit/event
 * pattern as ApprovalCenter.
 */
export class ReviewQueue {
  /**
   * @param {{store: import('./store.js').InMemoryReviewStore, auditLog: import('../logs/auditLog.js').AuditLog, approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, approvalCenter, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._approvalCenter = approvalCenter;
    this._eventBus = eventBus;
  }

  /**
   * Submit a completed unit of work for CEO review. Always starts
   * PENDING_REVIEW.
   * @param {{title: string, description?: string, submittedBy: string, payload?: Object}} input
   * @returns {import('../../shared/types.js').ReviewItem}
   */
  submit(input) {
    if (!input || !input.title || !input.submittedBy) {
      throw new Error("ReviewQueue.submit requires: title, submittedBy");
    }

    const now = new Date().toISOString();
    /** @type {import('../../shared/types.js').ReviewItem} */
    const item = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? "",
      submittedBy: input.submittedBy,
      status: REVIEW_STATUS.PENDING_REVIEW,
      payload: input.payload ?? {},
      approvalRequestId: null,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          action: "SUBMITTED",
          by: input.submittedBy,
          at: now,
        },
      ],
    };

    this._store.save(item);
    this._auditLog.record(input.submittedBy, "REVIEW_ITEM_SUBMITTED", {
      itemId: item.id,
      title: item.title,
      ...this._causationDetails(item),
    });
    this._emit(EVENTS.REVIEW_ITEM_SUBMITTED, item);

    return item;
  }

  /**
   * CEO accepts the item as-is. Terminal state — no founder approval needed.
   * @param {string} id
   * @param {{by: string, note?: string}} actor
   * @returns {import('../../shared/types.js').ReviewItem}
   */
  markReviewed(id, actor) {
    const item = this._requirePendingReview(id);

    item.status = REVIEW_STATUS.REVIEWED;
    item.updatedAt = new Date().toISOString();
    item.history.push({
      action: "REVIEWED",
      by: actor.by,
      at: item.updatedAt,
      note: actor.note,
    });

    this._store.save(item);
    this._auditLog.record(actor.by, "REVIEW_ITEM_REVIEWED", {
      itemId: id,
      ...this._causationDetails(item),
    });
    this._emit(EVENTS.REVIEW_ITEM_REVIEWED, item);

    return item;
  }

  /**
   * CEO sends the item onward for founder approval. Creates a real
   * ApprovalRequest in Approval Center and links it back on the item.
   * @param {string} id
   * @param {{by: string, riskLevel: string, note?: string}} actor
   * @returns {{item: import('../../shared/types.js').ReviewItem, approvalRequest: import('../../shared/types.js').ApprovalRequest}}
   */
  escalateToApproval(id, actor) {
    if (!actor || !actor.riskLevel) {
      throw new Error("ReviewQueue.escalateToApproval requires actor.riskLevel");
    }
    const item = this._requirePendingReview(id);

    const approvalRequest = this._approvalCenter.createRequest({
      title: item.title,
      description: item.description,
      requestedBy: actor.by,
      riskLevel: actor.riskLevel,
      payload: { ...item.payload, reviewItemId: item.id },
    });

    item.status = REVIEW_STATUS.ESCALATED;
    item.approvalRequestId = approvalRequest.id;
    item.updatedAt = new Date().toISOString();
    item.history.push({
      action: "ESCALATED",
      by: actor.by,
      at: item.updatedAt,
      note: actor.note,
    });

    this._store.save(item);
    this._auditLog.record(actor.by, "REVIEW_ITEM_ESCALATED", {
      itemId: id,
      approvalRequestId: approvalRequest.id,
      ...this._causationDetails(item),
    });
    this._emit(EVENTS.REVIEW_ITEM_ESCALATED, item);

    return { item, approvalRequest };
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
  _requirePendingReview(id) {
    const item = this._store.getById(id);
    if (!item) {
      throw new Error(`ReviewItem not found: ${id}`);
    }
    if (item.status !== REVIEW_STATUS.PENDING_REVIEW) {
      throw new Error(
        `ReviewItem ${id} is ${item.status}, only PENDING_REVIEW items can be reviewed/escalated`
      );
    }
    return item;
  }

  /**
   * Pulls known causation-link fields out of an item's payload so they
   * land in audit details too. Currently just taskId — this is what
   * lets a task's audit chain continue into Review Queue instead of
   * stopping at Task Board / CTO Agent.
   * @param {import('../../shared/types.js').ReviewItem} item
   */
  _causationDetails(item) {
    return item.payload?.taskId ? { taskId: item.payload.taskId } : {};
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
