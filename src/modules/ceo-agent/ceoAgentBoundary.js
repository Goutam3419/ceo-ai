import { randomUUID } from "node:crypto";
import { ROLES, RISK_LEVELS, EVENTS } from "../../shared/types.js";

/**
 * CEO Agent — INTEGRATION BOUNDARY, real module (not the final CEO Agent).
 *
 * The existing /admin CEO Chat Foundation v1 is a separate, prior piece
 * of work and is untouched by this scaffold. This module is the future
 * home for the real CEO Agent: goal intake, planning, task creation,
 * review requests, approval summaries.
 *
 * Contract for this milestone:
 *   - intakeGoal(): accept a founder goal, normalize it into an
 *     internal plan (a set of steps)
 *   - createTasksFromPlan(): turn a plan's steps into real Task Board
 *     tasks, one per step
 *   - requestApproval(): unchanged from the prior milestone — routes to
 *     Approval Center's public createRequest()
 *
 * CEO Agent has no reference to GitHub or Deployment at all, and never
 * touches Approval Center's internals — only its public createRequest()
 * method, same as before. Task creation goes through Task Board's
 * existing public createTask() method; CEO Agent does not maintain its
 * own task store.
 */
export class CeoAgentBoundary {
  /**
   * @param {{approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, taskBoard: import('../task-board/taskBoard.js').TaskBoard, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ approvalCenter, taskBoard, auditLog, eventBus = null }) {
    this._approvalCenter = approvalCenter;
    this._taskBoard = taskBoard;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
    /** @type {Map<string, {id: string, title: string, description: string, steps: string[], createdAt: string}>} */
    this._plans = new Map();
  }

  /**
   * Accept a founder goal and normalize it into an internal plan (a
   * flat list of steps). This is CEO Agent's own internal state — not
   * a shared framework type — same pattern as CTO Agent's work plans.
   * @param {{title: string, description?: string, steps: string[]}} goal
   * @returns {{id: string, title: string, description: string, steps: string[], createdAt: string}}
   */
  intakeGoal(goal) {
    if (!goal || !goal.title || !Array.isArray(goal.steps) || goal.steps.length === 0) {
      throw new Error("CeoAgentBoundary.intakeGoal requires: title, non-empty steps array");
    }

    const plan = {
      id: randomUUID(),
      title: goal.title,
      description: goal.description ?? "",
      steps: goal.steps,
      createdAt: new Date().toISOString(),
    };
    this._plans.set(plan.id, plan);

    this._auditLog.record(ROLES.CEO_AGENT, "CEO_GOAL_PLAN_CREATED", {
      goalId: plan.id,
      stepCount: plan.steps.length,
    });
    this._emit(EVENTS.CEO_GOAL_PLAN_CREATED, plan);

    return plan;
  }

  /** @param {string} goalId */
  getPlan(goalId) {
    return this._plans.get(goalId) ?? null;
  }

  /**
   * Turn a plan's steps into real Task Board tasks, one per step, via
   * Task Board's existing public createTask(). Task Board records and
   * emits its own TASK_CREATED audit/event entries — CEO Agent does
   * not duplicate that logging.
   * @param {string} goalId
   * @returns {import('../../shared/types.js').Task[]}
   */
  createTasksFromPlan(goalId) {
    const plan = this._plans.get(goalId);
    if (!plan) {
      throw new Error(`CeoAgentBoundary.createTasksFromPlan: plan not found: ${goalId}`);
    }

    return plan.steps.map((step) =>
      this._taskBoard.createTask({
        title: step,
        description: plan.description,
        createdBy: ROLES.CEO_AGENT,
        payload: { goalId: plan.id },
      })
    );
  }

  /**
   * Requests approval for a high-risk action. This is the ONLY way
   * CEO Agent may attempt something sensitive — it cannot execute
   * the action itself.
   * @param {{title: string, description?: string, riskLevel?: string, payload?: Object}} request
   */
  requestApproval(request) {
    return this._approvalCenter.createRequest({
      title: request.title,
      description: request.description,
      riskLevel: request.riskLevel ?? RISK_LEVELS.HIGH,
      requestedBy: ROLES.CEO_AGENT,
      payload: request.payload,
    });
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}

export const boundary = Object.freeze({
  module: "ceo-agent",
  status: "REAL", // sixth fully implemented module (boundary-scoped)
  implemented: [
    "intakeGoal() / getPlan() — goal intake + internal plan normalization",
    "createTasksFromPlan() — Task Board handoff, one task per plan step",
    "requestApproval() — routes to Approval Center",
  ],
  notImplemented: [
    "review requests / approval summaries back to founder",
    "persistence of plans beyond process memory",
    "goal intake from natural language (steps must already be a list)",
  ],
  note: "Not the final CEO Agent. /admin CEO Chat Foundation v1 is separate and unaffected. No reference to GitHub or Deployment; touches Approval Center only through its public createRequest().",
});
