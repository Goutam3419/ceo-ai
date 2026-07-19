import { test } from "node:test";
import assert from "node:assert/strict";

import { CeoAgentBoundary } from "../src/modules/ceo-agent/ceoAgentBoundary.js";
import { CtoAgentBoundary } from "../src/modules/cto-agent/ctoAgentBoundary.js";
import { TaskBoard } from "../src/modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../src/modules/task-board/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import {
  ROLES,
  RISK_LEVELS,
  TASK_STATUS,
  REVIEW_STATUS,
  APPROVAL_STATUS,
  EVENTS,
} from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
    eventBus,
  });
  const taskBoard = new TaskBoard({
    store: new InMemoryTaskStore(),
    auditLog: logsCenter,
    eventBus,
  });
  const ceoAgent = new CeoAgentBoundary({
    approvalCenter,
    taskBoard,
    auditLog: logsCenter,
    eventBus,
  });
  const reviewQueue = new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog: logsCenter,
    approvalCenter,
    eventBus,
  });
  const ctoAgent = new CtoAgentBoundary({
    taskBoard,
    reviewQueue,
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, approvalCenter, taskBoard, ceoAgent, reviewQueue, ctoAgent };
}

test("intakeGoal() normalizes a goal into a stored plan", () => {
  const { ceoAgent } = makeRig();

  const plan = ceoAgent.intakeGoal({
    title: "Launch referral program",
    description: "Q3 growth initiative",
    steps: ["Design referral flow", "Build API", "Add UI"],
  });

  assert.ok(plan.id);
  assert.equal(plan.title, "Launch referral program");
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(ceoAgent.getPlan(plan.id), plan);
});

test("intakeGoal() requires title and a non-empty steps array", () => {
  const { ceoAgent } = makeRig();
  assert.throws(() => ceoAgent.intakeGoal({ title: "x" }));
  assert.throws(() => ceoAgent.intakeGoal({ title: "x", steps: [] }));
  assert.throws(() => ceoAgent.intakeGoal({ steps: ["a"] }));
});

test("getPlan() returns null for an unknown goal id", () => {
  const { ceoAgent } = makeRig();
  assert.equal(ceoAgent.getPlan("does-not-exist"), null);
});

test("intakeGoal() records an audit entry and emits an event", () => {
  const { ceoAgent, logsCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.CEO_GOAL_PLAN_CREATED, (p) => seen.push(p.id));

  const plan = ceoAgent.intakeGoal({ title: "X", steps: ["a", "b"] });

  const entry = logsCenter.list({ action: "CEO_GOAL_PLAN_CREATED" })[0];
  assert.equal(entry.module, "ceo-agent");
  assert.equal(entry.details.goalId, plan.id);
  assert.equal(entry.details.stepCount, 2);
  assert.deepEqual(seen, [plan.id]);
});

test("createTasksFromPlan() creates one Task Board task per step", () => {
  const { ceoAgent, taskBoard } = makeRig();
  const plan = ceoAgent.intakeGoal({
    title: "Launch referral program",
    steps: ["Design referral flow", "Build API", "Add UI"],
  });

  const tasks = ceoAgent.createTasksFromPlan(plan.id);

  assert.equal(tasks.length, 3);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ["Design referral flow", "Build API", "Add UI"]
  );
  for (const t of tasks) {
    assert.equal(t.status, TASK_STATUS.TODO);
    assert.equal(t.createdBy, ROLES.CEO_AGENT);
    assert.equal(t.payload.goalId, plan.id);
  }
  // Confirm they're real, listable Task Board tasks, not side artifacts.
  assert.equal(taskBoard.list().length, 3);
});

test("createTasksFromPlan() on an unknown goal id throws", () => {
  const { ceoAgent } = makeRig();
  assert.throws(() => ceoAgent.createTasksFromPlan("does-not-exist"));
});

test("createTasksFromPlan() relies on Task Board's own audit/event logging, not duplicate CEO Agent entries", () => {
  const { ceoAgent, logsCenter } = makeRig();
  const plan = ceoAgent.intakeGoal({ title: "X", steps: ["step one"] });
  ceoAgent.createTasksFromPlan(plan.id);

  const taskCreatedEntries = logsCenter.list({ action: "TASK_CREATED" });
  assert.equal(taskCreatedEntries.length, 1);
  assert.equal(taskCreatedEntries[0].module, "task-board");
  assert.equal(taskCreatedEntries[0].actor, ROLES.CEO_AGENT);
});

test("requestApproval() is unchanged: still routes through Approval Center's public createRequest()", () => {
  const { ceoAgent } = makeRig();
  const req = ceoAgent.requestApproval({ title: "Deploy to production" });

  assert.equal(req.status, APPROVAL_STATUS.PENDING);
  assert.equal(req.requestedBy, ROLES.CEO_AGENT);
  assert.equal(req.riskLevel, RISK_LEVELS.HIGH);
});

test("CEO Agent boundary exposes no execute/deploy/github surface", () => {
  const { ceoAgent } = makeRig();
  assert.equal(typeof ceoAgent.execute, "undefined");
  assert.equal(typeof ceoAgent.deploy, "undefined");
  assert.equal(typeof ceoAgent.pushToGithub, "undefined");
  assert.equal(typeof ceoAgent.approve, "undefined");
});

test("full spine: CEO Agent goal -> tasks -> CTO Agent -> Review Queue -> Approval Center, one causation chain per task", () => {
  const { ceoAgent, ctoAgent, reviewQueue, approvalCenter, logsCenter } = makeRig();

  const plan = ceoAgent.intakeGoal({
    title: "Rotate infra credentials",
    steps: ["Rotate signing key"],
  });
  const [task] = ceoAgent.createTasksFromPlan(plan.id);

  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Generate", "Rotate", "Verify"] });
  const { reviewItem } = ctoAgent.submitForReview(task.id);

  assert.equal(reviewItem.status, REVIEW_STATUS.PENDING_REVIEW);

  const { approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  const approved = approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });
  assert.equal(approved.status, APPROVAL_STATUS.APPROVED);

  // One query, by the task's own id, surfaces the whole spine —
  // including the goal-plan step CEO Agent recorded.
  const taskChain = logsCenter.list({ refId: task.id });
  const modulesInChain = new Set(taskChain.map((e) => e.module));
  assert.ok(modulesInChain.has("task-board"));
  assert.ok(modulesInChain.has("cto-agent"));
  assert.ok(modulesInChain.has("review-queue"));
  assert.ok(modulesInChain.has("approval-center"));

  // The goal-plan step and the resulting task creation are both
  // queryable by the goal's own id — the gap where Task Board's
  // createTask() didn't propagate goalId into its audit details has
  // been closed.
  const goalChain = logsCenter.list({ refId: plan.id });
  assert.ok(goalChain.some((e) => e.action === "CEO_GOAL_PLAN_CREATED"));
  assert.ok(goalChain.some((e) => e.action === "TASK_CREATED"));
  assert.equal(task.payload.goalId, plan.id);
});
