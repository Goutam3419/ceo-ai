import { test } from "node:test";
import assert from "node:assert/strict";

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

function makeTaskBoard() {
  const auditLog = new AuditLog();
  const eventBus = new EventBus();
  const taskBoard = new TaskBoard({
    store: new InMemoryTaskStore(),
    auditLog,
    eventBus,
  });
  return { auditLog, eventBus, taskBoard };
}

test("createTask() starts TODO, unassigned, with a CREATED history entry", () => {
  const { taskBoard } = makeTaskBoard();
  const task = taskBoard.createTask({
    title: "Build /health endpoint",
    createdBy: ROLES.CEO_AGENT,
  });

  assert.equal(task.status, TASK_STATUS.TODO);
  assert.equal(task.owner, null);
  assert.equal(task.history.length, 1);
  assert.equal(task.history[0].action, "CREATED");
});

test("createTask() requires title and createdBy", () => {
  const { taskBoard } = makeTaskBoard();
  assert.throws(() => taskBoard.createTask({ title: "x" }));
});

test("updateStatus() moves a task between statuses freely, not one-way", () => {
  const { taskBoard } = makeTaskBoard();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });

  const inProgress = taskBoard.updateStatus(task.id, {
    by: ROLES.CTO_AGENT,
    status: TASK_STATUS.IN_PROGRESS,
  });
  assert.equal(inProgress.status, TASK_STATUS.IN_PROGRESS);

  const backToTodo = taskBoard.updateStatus(task.id, {
    by: ROLES.CTO_AGENT,
    status: TASK_STATUS.TODO,
  });
  assert.equal(backToTodo.status, TASK_STATUS.TODO);

  const done = taskBoard.updateStatus(task.id, {
    by: ROLES.CTO_AGENT,
    status: TASK_STATUS.DONE,
  });
  assert.equal(done.status, TASK_STATUS.DONE);
  assert.equal(done.history.length, 4); // CREATED + 3 STATUS_UPDATED
});

test("updateStatus() rejects an unrecognized status value", () => {
  const { taskBoard } = makeTaskBoard();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  assert.throws(() =>
    taskBoard.updateStatus(task.id, { by: ROLES.CTO_AGENT, status: "NOT_A_STATUS" })
  );
});

test("assignOwner() sets the owner and records history", () => {
  const { taskBoard } = makeTaskBoard();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });

  const assigned = taskBoard.assignOwner(task.id, {
    by: ROLES.CEO_AGENT,
    owner: ROLES.CTO_AGENT,
  });

  assert.equal(assigned.owner, ROLES.CTO_AGENT);
  assert.equal(assigned.history.at(-1).action, "OWNER_ASSIGNED");
});

test("assignOwner() requires an owner value", () => {
  const { taskBoard } = makeTaskBoard();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  assert.throws(() => taskBoard.assignOwner(task.id, { by: ROLES.CEO_AGENT }));
});

test("acting on an unknown task id throws", () => {
  const { taskBoard } = makeTaskBoard();
  assert.throws(() =>
    taskBoard.updateStatus("does-not-exist", { by: ROLES.CEO_AGENT, status: TASK_STATUS.DONE })
  );
  assert.throws(() =>
    taskBoard.assignOwner("does-not-exist", { by: ROLES.CEO_AGENT, owner: ROLES.CTO_AGENT })
  );
});

test("every task action writes an audit log entry", () => {
  const { taskBoard, auditLog } = makeTaskBoard();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  taskBoard.assignOwner(task.id, { by: ROLES.CEO_AGENT, owner: ROLES.CTO_AGENT });
  taskBoard.updateStatus(task.id, { by: ROLES.CTO_AGENT, status: TASK_STATUS.DONE });

  const actions = auditLog.list().map((e) => e.action);
  assert.deepEqual(actions, ["TASK_CREATED", "TASK_OWNER_ASSIGNED", "TASK_STATUS_UPDATED"]);
});

test("task events are emitted on the shared event bus", () => {
  const { taskBoard, eventBus } = makeTaskBoard();
  const seen = [];
  eventBus.on(EVENTS.TASK_CREATED, (t) => seen.push(["CREATED", t.id]));
  eventBus.on(EVENTS.TASK_STATUS_UPDATED, (t) => seen.push(["STATUS_UPDATED", t.id]));

  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  taskBoard.updateStatus(task.id, { by: ROLES.CTO_AGENT, status: TASK_STATUS.DONE });

  assert.deepEqual(seen, [
    ["CREATED", task.id],
    ["STATUS_UPDATED", task.id],
  ]);
});

test("list() filters by status and by owner", () => {
  const { taskBoard } = makeTaskBoard();
  const a = taskBoard.createTask({ title: "A", createdBy: ROLES.CEO_AGENT });
  taskBoard.createTask({ title: "B", createdBy: ROLES.CEO_AGENT });
  taskBoard.assignOwner(a.id, { by: ROLES.CEO_AGENT, owner: ROLES.CTO_AGENT });
  taskBoard.updateStatus(a.id, { by: ROLES.CTO_AGENT, status: TASK_STATUS.DONE });

  assert.equal(taskBoard.list({ status: TASK_STATUS.DONE }).length, 1);
  assert.equal(taskBoard.list({ status: TASK_STATUS.TODO }).length, 1);
  assert.equal(taskBoard.list({ owner: ROLES.CTO_AGENT }).length, 1);
});

test("handoff pattern: a DONE task's data flows into Review Queue -> Approval Center", () => {
  // TaskBoard does not call ReviewQueue itself; this proves the caller
  // can hand off using existing, unmodified contracts on both sides.
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

  const task = taskBoard.createTask({
    title: "Ship payment refactor",
    createdBy: ROLES.CEO_AGENT,
    payload: { repo: "billing-service" },
  });
  taskBoard.assignOwner(task.id, { by: ROLES.CEO_AGENT, owner: ROLES.CTO_AGENT });
  const done = taskBoard.updateStatus(task.id, {
    by: ROLES.CTO_AGENT,
    status: TASK_STATUS.DONE,
  });

  const reviewItem = reviewQueue.submit({
    title: done.title,
    description: done.description,
    submittedBy: done.owner,
    payload: { ...done.payload, taskId: done.id },
  });
  assert.equal(reviewItem.status, REVIEW_STATUS.PENDING_REVIEW);
  assert.equal(reviewItem.payload.taskId, done.id);

  const { item: escalated, approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  assert.equal(escalated.status, REVIEW_STATUS.ESCALATED);
  assert.equal(approvalRequest.payload.taskId, done.id);

  const approved = approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });
  assert.equal(approved.status, APPROVAL_STATUS.APPROVED);

  const actions = auditLog.list().map((e) => e.action);
  assert.deepEqual(actions, [
    "TASK_CREATED",
    "TASK_OWNER_ASSIGNED",
    "TASK_STATUS_UPDATED",
    "REVIEW_ITEM_SUBMITTED",
    "APPROVAL_REQUEST_CREATED",
    "REVIEW_ITEM_ESCALATED",
    "APPROVAL_REQUEST_APPROVED",
  ]);
});
