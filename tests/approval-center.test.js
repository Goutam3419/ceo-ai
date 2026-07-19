import { test } from "node:test";
import assert from "node:assert/strict";

import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { AuditLog } from "../src/modules/logs/auditLog.js";
import { EventBus } from "../src/shared/eventBus.js";
import { APPROVAL_STATUS, ROLES, RISK_LEVELS, EVENTS } from "../src/shared/types.js";
import { CeoAgentBoundary } from "../src/modules/ceo-agent/index.js";

function makeCenter() {
  return new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: new AuditLog(),
    eventBus: new EventBus(),
  });
}

test("createRequest starts PENDING with a CREATED history entry", () => {
  const center = makeCenter();
  const req = center.createRequest({
    title: "Deploy hotfix",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });

  assert.equal(req.status, APPROVAL_STATUS.PENDING);
  assert.equal(req.history.length, 1);
  assert.equal(req.history[0].action, "CREATED");
});

test("createRequest requires title, requestedBy, riskLevel", () => {
  const center = makeCenter();
  assert.throws(() => center.createRequest({ title: "x" }));
});

test("approve() transitions PENDING -> APPROVED", () => {
  const center = makeCenter();
  const req = center.createRequest({
    title: "Add DB column",
    requestedBy: ROLES.CTO_AGENT,
    riskLevel: RISK_LEVELS.MEDIUM,
  });

  const approved = center.approve(req.id, { by: ROLES.FOUNDER, note: "ok" });

  assert.equal(approved.status, APPROVAL_STATUS.APPROVED);
  assert.equal(approved.history.at(-1).action, "APPROVED");
  assert.equal(approved.history.at(-1).by, ROLES.FOUNDER);
});

test("reject() transitions PENDING -> REJECTED", () => {
  const center = makeCenter();
  const req = center.createRequest({
    title: "Delete prod table",
    requestedBy: ROLES.CTO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });

  const rejected = center.reject(req.id, { by: ROLES.FOUNDER, note: "no" });

  assert.equal(rejected.status, APPROVAL_STATUS.REJECTED);
});

test("edit() updates fields and stays PENDING", () => {
  const center = makeCenter();
  const req = center.createRequest({
    title: "Original title",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
  });

  const edited = center.edit(req.id, {
    by: ROLES.CEO_AGENT,
    changes: { title: "Revised title" },
  });

  assert.equal(edited.status, APPROVAL_STATUS.PENDING);
  assert.equal(edited.title, "Revised title");
  assert.equal(edited.history.at(-1).action, "EDITED");
});

test("approve() on a non-PENDING request throws", () => {
  const center = makeCenter();
  const req = center.createRequest({
    title: "One-shot",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
  });
  center.approve(req.id, { by: ROLES.FOUNDER });

  assert.throws(() => center.approve(req.id, { by: ROLES.FOUNDER }));
  assert.throws(() => center.reject(req.id, { by: ROLES.FOUNDER }));
  assert.throws(() =>
    center.edit(req.id, { by: ROLES.FOUNDER, changes: { title: "x" } })
  );
});

test("acting on an unknown id throws", () => {
  const center = makeCenter();
  assert.throws(() => center.approve("does-not-exist", { by: ROLES.FOUNDER }));
});

test("every mutating action writes an audit log entry", () => {
  const auditLog = new AuditLog();
  const center = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog,
  });

  const req = center.createRequest({
    title: "Ship feature",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.MEDIUM,
  });
  center.edit(req.id, { by: ROLES.CEO_AGENT, changes: { title: "Ship feature v2" } });
  center.approve(req.id, { by: ROLES.FOUNDER });

  const entries = auditLog.list();
  const actions = entries.map((e) => e.action);

  assert.deepEqual(actions, [
    "APPROVAL_REQUEST_CREATED",
    "APPROVAL_REQUEST_EDITED",
    "APPROVAL_REQUEST_APPROVED",
  ]);
});

test("approval events are emitted on the event bus", () => {
  const eventBus = new EventBus();
  const center = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: new AuditLog(),
    eventBus,
  });

  const seen = [];
  eventBus.on(EVENTS.APPROVAL_REQUESTED, (r) => seen.push(["REQUESTED", r.id]));
  eventBus.on(EVENTS.APPROVAL_APPROVED, (r) => seen.push(["APPROVED", r.id]));

  const req = center.createRequest({
    title: "Rotate API key",
    requestedBy: ROLES.CTO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  center.approve(req.id, { by: ROLES.FOUNDER });

  assert.deepEqual(seen, [
    ["REQUESTED", req.id],
    ["APPROVED", req.id],
  ]);
});

test("list() filters by status", () => {
  const center = makeCenter();
  const a = center.createRequest({
    title: "A",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
  });
  center.createRequest({
    title: "B",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.LOW,
  });
  center.approve(a.id, { by: ROLES.FOUNDER });

  assert.equal(center.list({ status: APPROVAL_STATUS.APPROVED }).length, 1);
  assert.equal(center.list({ status: APPROVAL_STATUS.PENDING }).length, 1);
});

test("CEO Agent boundary can only request approval, not decide it", () => {
  const center = makeCenter();
  const ceoAgent = new CeoAgentBoundary({ approvalCenter: center });

  const req = ceoAgent.requestApproval({
    title: "Deploy to production",
    payload: { branch: "main" },
  });

  assert.equal(req.status, APPROVAL_STATUS.PENDING);
  assert.equal(req.requestedBy, ROLES.CEO_AGENT);
  assert.equal(req.riskLevel, RISK_LEVELS.HIGH); // defaults to HIGH

  // CEO Agent boundary exposes no approve/reject/execute surface at all.
  assert.equal(typeof ceoAgent.approve, "undefined");
  assert.equal(typeof ceoAgent.reject, "undefined");
  assert.equal(typeof ceoAgent.execute, "undefined");
});

test("CEO Agent goal intake is explicitly not implemented yet", () => {
  const center = makeCenter();
  const ceoAgent = new CeoAgentBoundary({ approvalCenter: center });
  assert.throws(() => ceoAgent.intakeGoal());
});
