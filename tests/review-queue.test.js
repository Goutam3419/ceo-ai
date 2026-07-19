import { test } from "node:test";
import assert from "node:assert/strict";

import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { ReviewQueue } from "../src/modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../src/modules/review-queue/store.js";
import { AuditLog } from "../src/modules/logs/auditLog.js";
import { EventBus } from "../src/shared/eventBus.js";
import {
  ROLES,
  RISK_LEVELS,
  REVIEW_STATUS,
  APPROVAL_STATUS,
  EVENTS,
} from "../src/shared/types.js";

function makeRig() {
  const auditLog = new AuditLog();
  const eventBus = new EventBus();
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
  return { auditLog, eventBus, approvalCenter, reviewQueue };
}

test("submit() starts PENDING_REVIEW with a SUBMITTED history entry", () => {
  const { reviewQueue } = makeRig();
  const item = reviewQueue.submit({
    title: "Add /health endpoint",
    submittedBy: ROLES.CTO_AGENT,
  });

  assert.equal(item.status, REVIEW_STATUS.PENDING_REVIEW);
  assert.equal(item.history.length, 1);
  assert.equal(item.history[0].action, "SUBMITTED");
  assert.equal(item.approvalRequestId, null);
});

test("submit() requires title and submittedBy", () => {
  const { reviewQueue } = makeRig();
  assert.throws(() => reviewQueue.submit({ title: "x" }));
});

test("markReviewed() transitions PENDING_REVIEW -> REVIEWED without touching Approval Center", () => {
  const { reviewQueue, approvalCenter } = makeRig();
  const item = reviewQueue.submit({
    title: "Refactor logger",
    submittedBy: ROLES.CTO_AGENT,
  });

  const reviewed = reviewQueue.markReviewed(item.id, {
    by: ROLES.CEO_AGENT,
    note: "looks fine",
  });

  assert.equal(reviewed.status, REVIEW_STATUS.REVIEWED);
  assert.equal(reviewed.history.at(-1).action, "REVIEWED");
  assert.equal(approvalCenter.list().length, 0); // no approval request created
});

test("escalateToApproval() transitions to ESCALATED and creates a linked ApprovalRequest", () => {
  const { reviewQueue, approvalCenter } = makeRig();
  const item = reviewQueue.submit({
    title: "Deploy payment service change",
    submittedBy: ROLES.CTO_AGENT,
    payload: { branch: "main", filesChanged: 3 },
  });

  const { item: escalated, approvalRequest } = reviewQueue.escalateToApproval(
    item.id,
    { by: ROLES.CEO_AGENT, riskLevel: RISK_LEVELS.HIGH, note: "touches billing" }
  );

  assert.equal(escalated.status, REVIEW_STATUS.ESCALATED);
  assert.equal(escalated.approvalRequestId, approvalRequest.id);
  assert.equal(escalated.history.at(-1).action, "ESCALATED");

  assert.equal(approvalRequest.status, APPROVAL_STATUS.PENDING);
  assert.equal(approvalRequest.riskLevel, RISK_LEVELS.HIGH);
  assert.equal(approvalRequest.requestedBy, ROLES.CEO_AGENT);
  assert.equal(approvalRequest.payload.reviewItemId, item.id);
  assert.equal(approvalRequest.payload.branch, "main");

  // Now resolvable through the normal Approval Center flow.
  const approved = approvalCenter.approve(approvalRequest.id, { by: ROLES.FOUNDER });
  assert.equal(approved.status, APPROVAL_STATUS.APPROVED);
});

test("escalateToApproval() requires riskLevel", () => {
  const { reviewQueue } = makeRig();
  const item = reviewQueue.submit({ title: "X", submittedBy: ROLES.CTO_AGENT });
  assert.throws(() => reviewQueue.escalateToApproval(item.id, { by: ROLES.CEO_AGENT }));
});

test("markReviewed()/escalateToApproval() on a non-PENDING_REVIEW item throws", () => {
  const { reviewQueue } = makeRig();
  const item = reviewQueue.submit({ title: "X", submittedBy: ROLES.CTO_AGENT });
  reviewQueue.markReviewed(item.id, { by: ROLES.CEO_AGENT });

  assert.throws(() => reviewQueue.markReviewed(item.id, { by: ROLES.CEO_AGENT }));
  assert.throws(() =>
    reviewQueue.escalateToApproval(item.id, { by: ROLES.CEO_AGENT, riskLevel: RISK_LEVELS.LOW })
  );
});

test("acting on an unknown review item id throws", () => {
  const { reviewQueue } = makeRig();
  assert.throws(() => reviewQueue.markReviewed("does-not-exist", { by: ROLES.CEO_AGENT }));
});

test("every review action writes an audit log entry, including the escalated approval creation", () => {
  const { reviewQueue, auditLog } = makeRig();
  const item = reviewQueue.submit({ title: "X", submittedBy: ROLES.CTO_AGENT });
  reviewQueue.escalateToApproval(item.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.MEDIUM,
  });

  const actions = auditLog.list().map((e) => e.action);
  assert.deepEqual(actions, [
    "REVIEW_ITEM_SUBMITTED",
    "APPROVAL_REQUEST_CREATED",
    "REVIEW_ITEM_ESCALATED",
  ]);
});

test("review events are emitted on the shared event bus", () => {
  const { reviewQueue, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.REVIEW_ITEM_SUBMITTED, (i) => seen.push(["SUBMITTED", i.id]));
  eventBus.on(EVENTS.REVIEW_ITEM_ESCALATED, (i) => seen.push(["ESCALATED", i.id]));

  const item = reviewQueue.submit({ title: "X", submittedBy: ROLES.CTO_AGENT });
  reviewQueue.escalateToApproval(item.id, {
    by: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
  });

  assert.deepEqual(seen, [
    ["SUBMITTED", item.id],
    ["ESCALATED", item.id],
  ]);
});

test("list() filters review items by status", () => {
  const { reviewQueue } = makeRig();
  const a = reviewQueue.submit({ title: "A", submittedBy: ROLES.CTO_AGENT });
  reviewQueue.submit({ title: "B", submittedBy: ROLES.CTO_AGENT });
  reviewQueue.markReviewed(a.id, { by: ROLES.CEO_AGENT });

  assert.equal(reviewQueue.list({ status: REVIEW_STATUS.REVIEWED }).length, 1);
  assert.equal(reviewQueue.list({ status: REVIEW_STATUS.PENDING_REVIEW }).length, 1);
});
