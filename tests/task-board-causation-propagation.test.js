import { test } from "node:test";
import assert from "node:assert/strict";

import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { TaskBoard } from "../src/modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../src/modules/task-board/store.js";
import { CeoAgentBoundary } from "../src/modules/ceo-agent/ceoAgentBoundary.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { ROLES, TASK_STATUS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const taskBoard = new TaskBoard({ store: new InMemoryTaskStore(), auditLog: logsCenter });
  return { logsCenter, taskBoard };
}

test("Task Board: createTask() includes goalId in audit details when present in payload", () => {
  const { logsCenter, taskBoard } = makeRig();
  taskBoard.createTask({
    title: "Design referral flow",
    createdBy: ROLES.CEO_AGENT,
    payload: { goalId: "goal-123" },
  });

  const entry = logsCenter.list({ action: "TASK_CREATED" })[0];
  assert.equal(entry.details.goalId, "goal-123");
  assert.ok(entry.refIds.includes("goal-123"));
});

test("Task Board: updateStatus() and assignOwner() also include goalId when present in payload", () => {
  const { logsCenter, taskBoard } = makeRig();
  const task = taskBoard.createTask({
    title: "Build API",
    createdBy: ROLES.CEO_AGENT,
    payload: { goalId: "goal-consistency" },
  });

  taskBoard.assignOwner(task.id, { by: ROLES.CEO_AGENT, owner: ROLES.CTO_AGENT });
  taskBoard.updateStatus(task.id, { by: ROLES.CTO_AGENT, status: TASK_STATUS.IN_PROGRESS });

  const assignedEntry = logsCenter.list({ action: "TASK_OWNER_ASSIGNED" })[0];
  assert.equal(assignedEntry.details.goalId, "goal-consistency");
  assert.ok(assignedEntry.refIds.includes("goal-consistency"));

  const statusEntry = logsCenter.list({ action: "TASK_STATUS_UPDATED" })[0];
  assert.equal(statusEntry.details.goalId, "goal-consistency");
  assert.ok(statusEntry.refIds.includes("goal-consistency"));

  // All three action types for this task are now findable as one
  // chain via the goal's own id.
  const chain = logsCenter.list({ refId: "goal-consistency" });
  assert.deepEqual(
    chain.map((e) => e.action),
    ["TASK_CREATED", "TASK_OWNER_ASSIGNED", "TASK_STATUS_UPDATED"]
  );
});

test("Task Board: createTask() omits goalId cleanly when payload has none", () => {
  const { logsCenter, taskBoard } = makeRig();
  taskBoard.createTask({ title: "No goal link", createdBy: ROLES.CEO_AGENT });

  const entry = logsCenter.list({ action: "TASK_CREATED" })[0];
  assert.equal(entry.details.goalId, undefined);
});

test("a query by goalId now surfaces the Task Board TASK_CREATED event", () => {
  const { logsCenter, taskBoard } = makeRig();
  taskBoard.createTask({
    title: "Build API",
    createdBy: ROLES.CEO_AGENT,
    payload: { goalId: "goal-abc" },
  });
  taskBoard.createTask({
    title: "Unrelated task",
    createdBy: ROLES.CEO_AGENT,
    payload: { goalId: "goal-xyz" },
  });

  const chain = logsCenter.list({ refId: "goal-abc" });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].action, "TASK_CREATED");
  assert.equal(chain[0].details.goalId, "goal-abc");
});

test("end-to-end: CEO Agent intakeGoal() -> createTasksFromPlan() -> a single goalId query surfaces the Task Board creation event", () => {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
  });
  const taskBoard = new TaskBoard({ store: new InMemoryTaskStore(), auditLog: logsCenter });
  const ceoAgent = new CeoAgentBoundary({ approvalCenter, taskBoard, auditLog: logsCenter });

  const plan = ceoAgent.intakeGoal({
    title: "Launch referral program",
    steps: ["Design referral flow", "Build API"],
  });
  ceoAgent.createTasksFromPlan(plan.id);

  const chain = logsCenter.list({ refId: plan.id });
  const actions = chain.map((e) => e.action);

  assert.ok(actions.includes("CEO_GOAL_PLAN_CREATED"));
  // Two tasks were created from the plan -> two TASK_CREATED entries,
  // both now tied back to the same goalId.
  assert.equal(actions.filter((a) => a === "TASK_CREATED").length, 2);
});
