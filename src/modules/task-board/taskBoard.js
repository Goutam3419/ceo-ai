import { randomUUID } from "node:crypto";
import { TASK_STATUS, EVENTS } from "../../shared/types.js";

const VALID_STATUSES = new Set(Object.values(TASK_STATUS));

/**
 * TaskBoard — third real module in the framework.
 *
 * Where CEO Agent will (eventually) create tasks and CTO Agent will
 * pick them up. A finished task's data is what typically gets handed
 * to Review Queue's submit() as its payload — TaskBoard does not call
 * Review Queue itself; that handoff is the caller's responsibility,
 * same as CEO Agent calling Approval Center rather than a module
 * reaching into another module uninvited.
 *
 * Unlike Approval Center / Review Queue, task status is not a strict
 * one-way pipeline (a task can move back from IN_PROGRESS to TODO), so
 * there is no "only PENDING can transition" guard — only existence and
 * valid-status-value checks.
 */
export class TaskBoard {
  /**
   * @param {{store: import('./store.js').InMemoryTaskStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * Create a new task. Always starts TODO, unassigned.
   * @param {{title: string, description?: string, createdBy: string, payload?: Object}} input
   * @returns {import('../../shared/types.js').Task}
   */
  createTask(input) {
    if (!input || !input.title || !input.createdBy) {
      throw new Error("TaskBoard.createTask requires: title, createdBy");
    }

    const now = new Date().toISOString();
    /** @type {import('../../shared/types.js').Task} */
    const task = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? "",
      createdBy: input.createdBy,
      status: TASK_STATUS.TODO,
      owner: null,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now,
      history: [
        {
          action: "CREATED",
          by: input.createdBy,
          at: now,
        },
      ],
    };

    this._store.save(task);
    this._auditLog.record(input.createdBy, "TASK_CREATED", {
      taskId: task.id,
      title: task.title,
      ...this._causationDetails(task),
    });
    this._emit(EVENTS.TASK_CREATED, task);

    return task;
  }

  /**
   * @param {string} id
   * @param {{by: string, status: string, note?: string}} actor
   * @returns {import('../../shared/types.js').Task}
   */
  updateStatus(id, actor) {
    if (!actor || !VALID_STATUSES.has(actor.status)) {
      throw new Error(
        `TaskBoard.updateStatus requires a valid status: ${[...VALID_STATUSES].join(", ")}`
      );
    }
    const task = this._requireExisting(id);

    task.status = actor.status;
    task.updatedAt = new Date().toISOString();
    task.history.push({
      action: "STATUS_UPDATED",
      by: actor.by,
      at: task.updatedAt,
      note: actor.note,
    });

    this._store.save(task);
    this._auditLog.record(actor.by, "TASK_STATUS_UPDATED", {
      taskId: id,
      status: actor.status,
      ...this._causationDetails(task),
    });
    this._emit(EVENTS.TASK_STATUS_UPDATED, task);

    return task;
  }

  /**
   * @param {string} id
   * @param {{by: string, owner: string, note?: string}} actor
   * @returns {import('../../shared/types.js').Task}
   */
  assignOwner(id, actor) {
    if (!actor || !actor.owner) {
      throw new Error("TaskBoard.assignOwner requires actor.owner");
    }
    const task = this._requireExisting(id);

    task.owner = actor.owner;
    task.updatedAt = new Date().toISOString();
    task.history.push({
      action: "OWNER_ASSIGNED",
      by: actor.by,
      at: task.updatedAt,
      note: actor.note,
    });

    this._store.save(task);
    this._auditLog.record(actor.by, "TASK_OWNER_ASSIGNED", {
      taskId: id,
      owner: actor.owner,
      ...this._causationDetails(task),
    });
    this._emit(EVENTS.TASK_OWNER_ASSIGNED, task);

    return task;
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{status?: string, owner?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  /** @param {string} id */
  _requireExisting(id) {
    const task = this._store.getById(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }

  /**
   * Pulls known causation-link fields out of a task's payload so they
   * land in audit details too. Currently just goalId — this is what
   * lets CEO Agent's goal-plan chain continue into every Task Board
   * audit entry (TASK_CREATED, TASK_STATUS_UPDATED,
   * TASK_OWNER_ASSIGNED) for a task tied to that goal, not just its
   * creation. Same narrow pattern as ApprovalCenter/ReviewQueue's
   * _causationDetails: one optional field, added only when present.
   * @param {import('../../shared/types.js').Task} task
   */
  _causationDetails(task) {
    return task.payload?.goalId ? { goalId: task.payload.goalId } : {};
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
