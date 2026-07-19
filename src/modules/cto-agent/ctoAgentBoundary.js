import { ROLES, TASK_STATUS, EVENTS } from "../../shared/types.js";

/**
 * CTO Agent — INTEGRATION BOUNDARY, real module.
 *
 * Sits in the workflow between Task Board and Review Queue:
 * Founder -> CEO Agent -> CTO Agent -> GitHub/Deploy -> CEO Review -> Founder Approval
 *
 * CTO Agent's contract here is deliberately narrow:
 *   - acceptTask(): pull a task off Task Board and mark it in progress
 *   - createWorkPlan(): record a technical plan for that task
 *   - submitForReview(): mark the task done, optionally request a
 *     GitHub pull-request intent for it, then hand it to Review Queue
 *
 * It has NO reference to Deployment Center or Approval Center. GitHub
 * Center is now an OPTIONAL constructor dependency: when provided,
 * submitForReview() requests a pull-request *intent* (not a real PR —
 * GitHub Center never makes network calls) representing "this task's
 * work is ready for review." When not provided, submitForReview()
 * behaves exactly as before — this keeps every existing caller and
 * test that doesn't pass githubCenter unaffected. Work plans are
 * internal state (not written into Task's payload, since Task Board's
 * contract has no payload-update method) — kept here and attached to
 * the Review Queue payload at submission time.
 */
export class CtoAgentBoundary {
  /**
   * @param {{taskBoard: import('../task-board/taskBoard.js').TaskBoard, reviewQueue: import('../review-queue/reviewQueue.js').ReviewQueue, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus, githubCenter?: import('../github/githubCenter.js').GitHubCenter}} deps
   */
  constructor({ taskBoard, reviewQueue, auditLog, eventBus = null, githubCenter = null }) {
    this._taskBoard = taskBoard;
    this._reviewQueue = reviewQueue;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
    this._githubCenter = githubCenter;
    /** @type {Map<string, {steps: string[], notes: string}>} */
    this._workPlans = new Map();
  }

  /**
   * Pull a task off Task Board: assign it to CTO_AGENT and move it to
   * IN_PROGRESS. Uses Task Board's existing public methods only.
   * @param {string} taskId
   * @returns {import('../../shared/types.js').Task}
   */
  acceptTask(taskId) {
    const task = this._taskBoard.getById(taskId);
    if (!task) {
      throw new Error(`CtoAgentBoundary.acceptTask: task not found: ${taskId}`);
    }

    this._taskBoard.assignOwner(taskId, {
      by: ROLES.CTO_AGENT,
      owner: ROLES.CTO_AGENT,
      note: "Accepted by CTO Agent",
    });

    return this._taskBoard.updateStatus(taskId, {
      by: ROLES.CTO_AGENT,
      status: TASK_STATUS.IN_PROGRESS,
    });
  }

  /**
   * Record a technical work plan for a task. This is CTO Agent's own
   * internal state (not part of Task Board's contract).
   * @param {string} taskId
   * @param {{steps: string[], notes?: string}} plan
   */
  createWorkPlan(taskId, plan) {
    if (!this._taskBoard.getById(taskId)) {
      throw new Error(`CtoAgentBoundary.createWorkPlan: task not found: ${taskId}`);
    }
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error("CtoAgentBoundary.createWorkPlan requires a non-empty steps array");
    }

    const workPlan = { steps: plan.steps, notes: plan.notes ?? "" };
    this._workPlans.set(taskId, workPlan);

    this._auditLog.record(ROLES.CTO_AGENT, "CTO_WORK_PLAN_CREATED", {
      taskId,
      stepCount: workPlan.steps.length,
    });
    this._emit(EVENTS.CTO_WORK_PLAN_CREATED, { taskId, workPlan });

    return workPlan;
  }

  /** @param {string} taskId */
  getWorkPlan(taskId) {
    return this._workPlans.get(taskId) ?? null;
  }

  /**
   * Mark the task DONE, optionally request a GitHub pull-request
   * intent for it, then hand it to Review Queue as a review-ready
   * output. This is the only way CTO Agent moves work forward — it
   * cannot deploy, merge, or approve anything itself, and the GitHub
   * call (when made) only records intent — no network call happens.
   * @param {string} taskId
   * @returns {{task: import('../../shared/types.js').Task, reviewItem: import('../../shared/types.js').ReviewItem, githubIntent: import('../../shared/types.js').GithubIntent|null}}
   */
  submitForReview(taskId) {
    const task = this._taskBoard.getById(taskId);
    if (!task) {
      throw new Error(`CtoAgentBoundary.submitForReview: task not found: ${taskId}`);
    }

    const done = this._taskBoard.updateStatus(taskId, {
      by: ROLES.CTO_AGENT,
      status: TASK_STATUS.DONE,
    });

    // Optional: request a PR intent representing "this task's work is
    // ready for review." Only runs if GitHub Center was wired in —
    // callers/tests that don't provide it see identical behavior to
    // before this integration. taskId is passed through so the intent
    // joins this task's existing causation chain in Logs Center.
    let githubIntent = null;
    if (this._githubCenter) {
      githubIntent = this._githubCenter.requestPullRequest({
        repo: done.payload?.repo ?? "unspecified-repo",
        sourceBranch: `feature/${done.id}`,
        targetBranch: "main",
        title: done.title,
        requestedBy: ROLES.CTO_AGENT,
        taskId: done.id,
      });
    }

    const reviewItem = this._reviewQueue.submit({
      title: done.title,
      description: done.description,
      submittedBy: ROLES.CTO_AGENT,
      payload: {
        ...done.payload,
        taskId: done.id,
        workPlan: this.getWorkPlan(taskId),
        ...(githubIntent ? { githubIntentId: githubIntent.id } : {}),
      },
    });

    return { task: done, reviewItem, githubIntent };
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}

export const boundary = Object.freeze({
  module: "cto-agent",
  status: "REAL", // fourth fully implemented module (boundary-scoped)
  implemented: [
    "acceptTask() — Task Board handoff (assign + IN_PROGRESS)",
    "createWorkPlan() / getWorkPlan() — internal technical plan state",
    "submitForReview() — Task Board DONE + optional GitHub PR intent + Review Queue submit",
  ],
  notImplemented: [
    "code generation / actual implementation execution",
    "real GitHub API calls (GitHub Center itself never makes any — intent only)",
    "Deployment Center integration",
    "persistence of work plans beyond process memory",
  ],
  note: "No reference to Deployment or Approval Center. GitHub Center is an optional dependency used only to record a PR intent at submission time — never a real network call. Can only call Task Board, Review Queue, and GitHub Center through their existing public methods.",
});
