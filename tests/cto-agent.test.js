import { test } from "node:test";
import assert from "node:assert/strict";

import { CtoAgentBoundary } from "../src/modules/cto-agent/ctoAgentBoundary.js";
import { TaskBoard } from "../src/modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../src/modules/task-board/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { AuditLog } from "../src/modules/logs/auditLog.js";
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
  const auditLog = new AuditLog();
  const eventBus = new EventBus();
  const taskBoard = new TaskBoard({ store: new InMemoryTaskStore(), auditLog, eventBus });
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog,
    eventBus,
  });
  const reviewQueue = new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog,
    approvalCenter,
    eventBus,
  });
  const ctoAgent = new CtoAgentBoundary({ taskBoard, reviewQueue, auditLog, eventBus });
  return { auditLog, eventBus, taskBoard, reviewQueue, approvalCenter, ctoAgent };
}

test("acceptTask() assigns owner CTO_AGENT and moves task to IN_PROGRESS", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "Add caching layer", createdBy: ROLES.CEO_AGENT });

  const accepted = ctoAgent.acceptTask(task.id);

  assert.equal(accepted.owner, ROLES.CTO_AGENT);
  assert.equal(accepted.status, TASK_STATUS.IN_PROGRESS);
});

test("acceptTask() on an unknown task id throws", () => {
  const { ctoAgent } = makeRig();
  assert.throws(() => ctoAgent.acceptTask("does-not-exist"));
});

test("createWorkPlan() stores a plan and getWorkPlan() retrieves it", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);

  const plan = ctoAgent.createWorkPlan(task.id, {
    steps: ["Design schema", "Write migration", "Add tests"],
    notes: "Low risk change",
  });

  assert.equal(plan.steps.length, 3);
  assert.deepEqual(ctoAgent.getWorkPlan(task.id), plan);
});

test("createWorkPlan() requires a non-empty steps array", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  assert.throws(() => ctoAgent.createWorkPlan(task.id, { steps: [] }));
  assert.throws(() => ctoAgent.createWorkPlan(task.id, {}));
});

test("createWorkPlan() on an unknown task id throws", () => {
  const { ctoAgent } = makeRig();
  assert.throws(() => ctoAgent.createWorkPlan("does-not-exist", { steps: ["a"] }));
});

test("getWorkPlan() returns null when no plan has been created", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  assert.equal(ctoAgent.getWorkPlan(task.id), null);
});

test("submitForReview() marks the task DONE and creates a matching Review Queue item", () => {
  const { taskBoard, reviewQueue, ctoAgent } = makeRig();
  const task = taskBoard.createTask({
    title: "Ship payment refactor",
    description: "Refactor billing module",
    createdBy: ROLES.CEO_AGENT,
    payload: { repo: "billing-service" },
  });
  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Refactor", "Test", "Ship"] });

  const { task: done, reviewItem } = ctoAgent.submitForReview(task.id);

  assert.equal(done.status, TASK_STATUS.DONE);
  assert.equal(reviewItem.status, REVIEW_STATUS.PENDING_REVIEW);
  assert.equal(reviewItem.submittedBy, ROLES.CTO_AGENT);
  assert.equal(reviewItem.title, task.title);
  assert.equal(reviewItem.payload.taskId, task.id);
  assert.equal(reviewItem.payload.repo, "billing-service");
  assert.deepEqual(reviewItem.payload.workPlan, { steps: ["Refactor", "Test", "Ship"], notes: "" });

  // Confirm it's a real, listable item in Review Queue, not a side artifact.
  assert.equal(reviewQueue.getById(reviewItem.id).id, reviewItem.id);
});

test("submitForReview() on an unknown task id throws", () => {
  const { ctoAgent } = makeRig();
  assert.throws(() => ctoAgent.submitForReview("does-not-exist"));
});

test("full handoff: CTO Agent work flows through Review Queue into Approval Center", () => {
  const { taskBoard, reviewQueue, approvalCenter, ctoAgent, auditLog } = makeRig();
  const task = taskBoard.createTask({ title: "Rotate signing key", createdBy: ROLES.CEO_AGENT });

  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Generate key", "Rotate", "Verify"] });
  const { reviewItem } = ctoAgent.submitForReview(task.id);

  const { item: escalated, approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  assert.equal(escalated.status, REVIEW_STATUS.ESCALATED);
  assert.equal(approvalRequest.payload.taskId, task.id);

  const approved = approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });
  assert.equal(approved.status, APPROVAL_STATUS.APPROVED);

  const actions = auditLog.list().map((e) => e.action);
  assert.deepEqual(actions, [
    "TASK_CREATED",
    "TASK_OWNER_ASSIGNED",
    "TASK_STATUS_UPDATED", // acceptTask -> IN_PROGRESS
    "CTO_WORK_PLAN_CREATED",
    "TASK_STATUS_UPDATED", // submitForReview -> DONE
    "REVIEW_ITEM_SUBMITTED",
    "APPROVAL_REQUEST_CREATED",
    "REVIEW_ITEM_ESCALATED",
    "APPROVAL_REQUEST_APPROVED",
  ]);
});

test("createWorkPlan() emits an event on the shared event bus", () => {
  const { taskBoard, ctoAgent, eventBus } = makeRig();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });

  const seen = [];
  eventBus.on(EVENTS.CTO_WORK_PLAN_CREATED, (p) => seen.push(p.taskId));

  ctoAgent.createWorkPlan(task.id, { steps: ["a"] });

  assert.deepEqual(seen, [task.id]);
});

test("CTO Agent boundary exposes no execute/deploy/approve/reject surface", () => {
  const { ctoAgent } = makeRig();
  assert.equal(typeof ctoAgent.execute, "undefined");
  assert.equal(typeof ctoAgent.deploy, "undefined");
  assert.equal(typeof ctoAgent.approve, "undefined");
  assert.equal(typeof ctoAgent.reject, "undefined");
  assert.equal(typeof ctoAgent.pushToGithub, "undefined");
});
