import { test } from "node:test";
import assert from "node:assert/strict";

import { CtoAgentBoundary } from "../src/modules/cto-agent/ctoAgentBoundary.js";
import { TaskBoard } from "../src/modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../src/modules/task-board/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { GitHubCenter } from "../src/modules/github/githubCenter.js";
import { InMemoryGithubIntentStore } from "../src/modules/github/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, TASK_STATUS, EVENTS } from "../src/shared/types.js";

function makeRig({ withGithub = true } = {}) {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
    eventBus,
  });
  const taskBoard = new TaskBoard({ store: new InMemoryTaskStore(), auditLog: logsCenter, eventBus });
  const reviewQueue = new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog: logsCenter,
    approvalCenter,
    eventBus,
  });
  const githubCenter = withGithub
    ? new GitHubCenter({ store: new InMemoryGithubIntentStore(), auditLog: logsCenter, eventBus })
    : null;
  const ctoAgent = new CtoAgentBoundary({
    taskBoard,
    reviewQueue,
    auditLog: logsCenter,
    eventBus,
    ...(withGithub ? { githubCenter } : {}),
  });
  return { logsCenter, eventBus, taskBoard, reviewQueue, approvalCenter, githubCenter, ctoAgent };
}

test("submitForReview() requests a GitHub PR intent when GitHub Center is wired", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({
    title: "Rotate signing key",
    createdBy: ROLES.CEO_AGENT,
    payload: { repo: "billing-service" },
  });
  ctoAgent.acceptTask(task.id);

  const { githubIntent, task: done } = ctoAgent.submitForReview(task.id);

  assert.ok(githubIntent);
  assert.equal(githubIntent.type, "OPEN_PULL_REQUEST");
  assert.equal(githubIntent.status, "RECORDED");
  assert.equal(githubIntent.repo, "billing-service");
  assert.equal(githubIntent.title, done.title);
  assert.equal(githubIntent.requestedBy, ROLES.CTO_AGENT);
  assert.equal(githubIntent.taskId, task.id);
});

test("submitForReview() falls back to a placeholder repo when the task payload has none", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "No repo specified", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);

  const { githubIntent } = ctoAgent.submitForReview(task.id);

  assert.equal(githubIntent.repo, "unspecified-repo");
});

test("the GitHub PR intent joins the task's existing causation chain", () => {
  const { taskBoard, ctoAgent, logsCenter } = makeRig();
  const task = taskBoard.createTask({ title: "Rotate key", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Generate", "Rotate", "Verify"] });
  ctoAgent.submitForReview(task.id);

  const chain = logsCenter.list({ refId: task.id });
  const actions = chain.map((e) => e.action);

  assert.ok(actions.includes("TASK_CREATED"));
  assert.ok(actions.includes("CTO_WORK_PLAN_CREATED"));
  assert.ok(actions.includes("GITHUB_PR_INTENT_RECORDED"));
  assert.ok(actions.includes("REVIEW_ITEM_SUBMITTED"));

  const modules = new Set(chain.map((e) => e.module));
  assert.ok(modules.has("github"));
});

test("the review item's payload links back to the GitHub intent via githubIntentId", () => {
  const { taskBoard, ctoAgent } = makeRig();
  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);

  const { reviewItem, githubIntent } = ctoAgent.submitForReview(task.id);

  assert.equal(reviewItem.payload.githubIntentId, githubIntent.id);
});

test("full spine still works end to end with GitHub Center wired: Task Board -> CTO Agent -> GitHub intent -> Review Queue -> Approval Center", () => {
  const { taskBoard, ctoAgent, reviewQueue, approvalCenter } = makeRig();
  const task = taskBoard.createTask({ title: "Ship feature", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);
  ctoAgent.createWorkPlan(task.id, { steps: ["Build", "Test"] });
  const { reviewItem } = ctoAgent.submitForReview(task.id);

  const { approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: "HIGH",
  });
  const approved = approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });

  assert.equal(approved.status, "APPROVED");
  assert.equal(taskBoard.getById(task.id).status, TASK_STATUS.DONE);
});

test("requestPullRequest event is emitted on the shared bus when CTO Agent submits for review", () => {
  const { taskBoard, ctoAgent, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.GITHUB_PR_INTENT_RECORDED, (intent) => seen.push(intent.type));

  const task = taskBoard.createTask({ title: "X", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);
  ctoAgent.submitForReview(task.id);

  assert.deepEqual(seen, ["OPEN_PULL_REQUEST"]);
});

test("backward compatibility: submitForReview() behaves exactly as before when GitHub Center is not provided", () => {
  const { taskBoard, ctoAgent } = makeRig({ withGithub: false });
  const task = taskBoard.createTask({ title: "No GitHub wired", createdBy: ROLES.CEO_AGENT });
  ctoAgent.acceptTask(task.id);

  const { task: done, reviewItem, githubIntent } = ctoAgent.submitForReview(task.id);

  assert.equal(done.status, TASK_STATUS.DONE);
  assert.equal(reviewItem.status, "PENDING_REVIEW");
  assert.equal(githubIntent, null);
  assert.equal(reviewItem.payload.githubIntentId, undefined);
});

test("CTO Agent still exposes no execute/deploy/push/merge surface of its own", () => {
  const { ctoAgent } = makeRig();
  assert.equal(typeof ctoAgent.execute, "undefined");
  assert.equal(typeof ctoAgent.deploy, "undefined");
  assert.equal(typeof ctoAgent.pushToGithub, "undefined");
  assert.equal(typeof ctoAgent.merge, "undefined");
});
