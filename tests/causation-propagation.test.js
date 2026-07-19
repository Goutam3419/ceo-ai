import { test } from "node:test";
import assert from "node:assert/strict";

import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { ROLES, RISK_LEVELS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
  });
  const reviewQueue = new ReviewQueue({
    store: new InMemoryReviewStore(),
    auditLog: logsCenter,
    approvalCenter,
  });
  return { logsCenter, approvalCenter, reviewQueue };
}

test("Review Queue: submit() includes taskId in audit details when present in payload", () => {
  const { logsCenter, reviewQueue } = makeRig();
  reviewQueue.submit({
    title: "Ship refactor",
    submittedBy: ROLES.CTO_AGENT,
    payload: { taskId: "task-123", repo: "billing-service" },
  });

  const entry = logsCenter.list({ action: "REVIEW_ITEM_SUBMITTED" })[0];
  assert.equal(entry.details.taskId, "task-123");
  assert.ok(entry.refIds.includes("task-123"));
});

test("Review Queue: submit() omits taskId cleanly when payload has none", () => {
  const { logsCenter, reviewQueue } = makeRig();
  reviewQueue.submit({ title: "No task link", submittedBy: ROLES.CTO_AGENT });

  const entry = logsCenter.list({ action: "REVIEW_ITEM_SUBMITTED" })[0];
  assert.equal(entry.details.taskId, undefined);
});

test("Review Queue: markReviewed() and escalateToApproval() also propagate taskId", () => {
  const { logsCenter, reviewQueue } = makeRig();
  const reviewed = reviewQueue.submit({
    title: "Reviewed path",
    submittedBy: ROLES.CTO_AGENT,
    payload: { taskId: "task-A" },
  });
  reviewQueue.markReviewed(reviewed.id, { by: ROLES.CEO_AGENT });

  const escalatedItem = reviewQueue.submit({
    title: "Escalated path",
    submittedBy: ROLES.CTO_AGENT,
    payload: { taskId: "task-B" },
  });
  reviewQueue.escalateToApproval(escalatedItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });

  const reviewedEntry = logsCenter.list({ action: "REVIEW_ITEM_REVIEWED" })[0];
  assert.equal(reviewedEntry.details.taskId, "task-A");

  const escalatedEntry = logsCenter.list({ action: "REVIEW_ITEM_ESCALATED" })[0];
  assert.equal(escalatedEntry.details.taskId, "task-B");
});

test("Approval Center: createRequest() derives taskId from payload into audit details", () => {
  const { logsCenter, approvalCenter } = makeRig();
  approvalCenter.createRequest({
    title: "Deploy change",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
    payload: { taskId: "task-999" },
  });

  const entry = logsCenter.list({ action: "APPROVAL_REQUEST_CREATED" })[0];
  assert.equal(entry.details.taskId, "task-999");
});

test("Approval Center: approve()/reject()/edit() carry the same taskId through their audit details", () => {
  const { logsCenter, approvalCenter } = makeRig();
  const req = approvalCenter.createRequest({
    title: "Rotate key",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
    payload: { taskId: "task-777" },
  });
  approvalCenter.approve(req.id, { by: ROLES.FOUNDER });

  const approvedEntry = logsCenter.list({ action: "APPROVAL_REQUEST_APPROVED" })[0];
  assert.equal(approvedEntry.details.taskId, "task-777");

  const { logsCenter: logsCenter2, approvalCenter: approvalCenter2 } = makeRig();
  const req2 = approvalCenter2.createRequest({
    title: "Reject me",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
    payload: { taskId: "task-888" },
  });
  approvalCenter2.reject(req2.id, { by: ROLES.FOUNDER });
  assert.equal(
    logsCenter2.list({ action: "APPROVAL_REQUEST_REJECTED" })[0].details.taskId,
    "task-888"
  );

  const { logsCenter: logsCenter3, approvalCenter: approvalCenter3 } = makeRig();
  const req3 = approvalCenter3.createRequest({
    title: "Edit me",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
    payload: { taskId: "task-555" },
  });
  approvalCenter3.edit(req3.id, { by: ROLES.CEO_AGENT, changes: { title: "Edited title" } });
  assert.equal(
    logsCenter3.list({ action: "APPROVAL_REQUEST_EDITED" })[0].details.taskId,
    "task-555"
  );
});

test("end-to-end: the full causation chain for one task reaches Task Board -> Review Queue -> Approval Center via a single refId query", () => {
  const { logsCenter, approvalCenter, reviewQueue } = makeRig();

  // Simulate what CTO Agent's submitForReview() does: a task's own id
  // gets carried into Review Queue's payload as taskId.
  const taskId = "task-end-to-end";
  const reviewItem = reviewQueue.submit({
    title: "Payment refactor",
    submittedBy: ROLES.CTO_AGENT,
    payload: { taskId },
  });
  const { approvalRequest } = reviewQueue.escalateToApproval(reviewItem.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });

  const chain = logsCenter.list({ refId: taskId });
  const actions = chain.map((e) => e.action);
  const modules = new Set(chain.map((e) => e.module));

  assert.ok(actions.includes("REVIEW_ITEM_SUBMITTED"));
  assert.ok(actions.includes("REVIEW_ITEM_ESCALATED"));
  assert.ok(actions.includes("APPROVAL_REQUEST_CREATED"));
  assert.ok(actions.includes("APPROVAL_REQUEST_APPROVED"));
  assert.ok(modules.has("review-queue"));
  assert.ok(modules.has("approval-center"));
});
