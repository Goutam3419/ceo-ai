import { test } from "node:test";
import assert from "node:assert/strict";

import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { TaskBoard } from "../src/modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../src/modules/task-board/store.js";
import { CtoAgentBoundary } from "../src/modules/cto-agent/ctoAgentBoundary.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, RISK_LEVELS, EVENTS } from "../src/shared/types.js";

test("record() infers module from action prefix", () => {
  const logs = new LogsCenter();

  const a = logs.record(ROLES.FOUNDER, "APPROVAL_REQUEST_CREATED", { requestId: "r1" });
  const b = logs.record(ROLES.CEO_AGENT, "REVIEW_ITEM_SUBMITTED", { itemId: "i1" });
  const c = logs.record(ROLES.CTO_AGENT, "TASK_STATUS_UPDATED", { taskId: "t1" });
  const d = logs.record(ROLES.CTO_AGENT, "CTO_WORK_PLAN_CREATED", { taskId: "t1" });
  const e = logs.record(ROLES.FOUNDER, "SOMETHING_UNRECOGNIZED", {});

  assert.equal(a.module, "approval-center");
  assert.equal(b.module, "review-queue");
  assert.equal(c.module, "task-board");
  assert.equal(d.module, "cto-agent");
  assert.equal(e.module, "unknown");
});

test("record() extracts causation refIds from any *Id detail key", () => {
  const logs = new LogsCenter();
  const entry = logs.record(ROLES.CTO_AGENT, "REVIEW_ITEM_ESCALATED", {
    itemId: "item-1",
    approvalRequestId: "req-1",
    stepCount: 3, // not a string *Id value -> ignored
  });

  assert.deepEqual(entry.refIds.sort(), ["item-1", "req-1"]);
});

test("record() with no *Id keys produces an empty refIds array", () => {
  const logs = new LogsCenter();
  const entry = logs.record(ROLES.FOUNDER, "TASK_CREATED", { title: "no ids here" });
  assert.deepEqual(entry.refIds, []);
});

test("getById() returns the matching entry or null", () => {
  const logs = new LogsCenter();
  const entry = logs.record(ROLES.FOUNDER, "TASK_CREATED", { taskId: "t1" });

  assert.equal(logs.getById(entry.id).id, entry.id);
  assert.equal(logs.getById("does-not-exist"), null);
});

test("list() filters by module, action, and actor", () => {
  const logs = new LogsCenter();
  logs.record(ROLES.CEO_AGENT, "APPROVAL_REQUEST_CREATED", { requestId: "r1" });
  logs.record(ROLES.FOUNDER, "APPROVAL_REQUEST_APPROVED", { requestId: "r1" });
  logs.record(ROLES.CTO_AGENT, "TASK_STATUS_UPDATED", { taskId: "t1" });

  assert.equal(logs.list({ module: "approval-center" }).length, 2);
  assert.equal(logs.list({ action: "APPROVAL_REQUEST_APPROVED" }).length, 1);
  assert.equal(logs.list({ actor: ROLES.CTO_AGENT }).length, 1);
  assert.equal(logs.list().length, 3);
});

test("list() filters by refId to surface a causation chain across modules", () => {
  const logs = new LogsCenter();
  logs.record(ROLES.CEO_AGENT, "TASK_CREATED", { taskId: "shared-task" });
  logs.record(ROLES.CTO_AGENT, "TASK_STATUS_UPDATED", { taskId: "shared-task" });
  logs.record(ROLES.CTO_AGENT, "REVIEW_ITEM_SUBMITTED", { itemId: "shared-task" }); // unrelated id, same value coincidentally
  logs.record(ROLES.CEO_AGENT, "TASK_CREATED", { taskId: "other-task" });

  const chain = logs.list({ refId: "shared-task" });
  assert.equal(chain.length, 3);
});

test("record() emits a LOG_RECORDED event on the shared event bus", () => {
  const eventBus = new EventBus();
  const logs = new LogsCenter({ eventBus });
  const seen = [];
  eventBus.on(EVENTS.LOG_RECORDED, (entry) => seen.push(entry.action));

  logs.record(ROLES.FOUNDER, "TASK_CREATED", { taskId: "t1" });

  assert.deepEqual(seen, ["TASK_CREATED"]);
});

test("integration: Approval Center's existing record() calls work unchanged against LogsCenter", () => {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter, // duck-typed the same way AuditLog was used
  });

  const req = approvalCenter.createRequest({
    title: "Deploy hotfix",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  approvalCenter.approve(req.id, { by: ROLES.FOUNDER });

  const entries = logsCenter.list({ module: "approval-center" });
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.action),
    ["APPROVAL_REQUEST_CREATED", "APPROVAL_REQUEST_APPROVED"]
  );
  // both entries concern the same request -> retrievable as one chain
  assert.equal(logsCenter.list({ refId: req.id }).length, 2);
});

test("integration: causation gap closed — a task's chain now spans Task Board, CTO Agent, Review Queue, and Approval Center", () => {
  const eventBus = new EventBus();
  const logsCenter = new LogsCenter({ eventBus });

  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
    eventBus,
  });
  const reviewQueue = new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog: logsCenter,
    approvalCenter,
    eventBus,
  });
  const taskBoard = new TaskBoard({
    store: new InMemoryTaskStore(),
    auditLog: logsCenter,
    eventBus,
  });
  const ctoAgent = new CtoAgentBoundary({
    taskBoard,
    reviewQueue,
    auditLog: logsCenter,
    eventBus,
  });

  const task = taskBoard.createTask({ title: "Rotate signing key", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Generate", "Rotate", "Verify"] });
  const { reviewItem } = ctoAgent.submitForReview(task.id);
  const { approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });

  // The causation gap is now closed: task-board, cto-agent, and
  // review-queue all record the originating taskId, so the full chain
  // for one piece of work is queryable by the task's id alone.
  const taskChain = logsCenter.list({ refId: task.id });
  const modulesInChain = new Set(taskChain.map((e) => e.module));
  assert.ok(taskChain.length >= 6);
  assert.ok(modulesInChain.has("task-board"));
  assert.ok(modulesInChain.has("cto-agent"));
  assert.ok(modulesInChain.has("review-queue"));

  // Approval Center derives taskId from the request payload (which
  // Review Queue populated via item.payload spread), so it's part of
  // the same chain too.
  assert.ok(modulesInChain.has("approval-center"));
  assert.ok(taskChain.some((e) => e.action === "APPROVAL_REQUEST_APPROVED"));

  const reviewChain = logsCenter.list({ refId: reviewItem.id });
  assert.ok(reviewChain.some((e) => e.action === "REVIEW_ITEM_SUBMITTED"));
  assert.ok(reviewChain.some((e) => e.action === "REVIEW_ITEM_ESCALATED"));

  const approvalChain = logsCenter.list({ refId: approvalRequest.id });
  assert.ok(approvalChain.some((e) => e.action === "APPROVAL_REQUEST_APPROVED"));
});
