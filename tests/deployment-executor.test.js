import { test } from "node:test";
import assert from "node:assert/strict";

import { DeploymentCenter } from "../src/modules/deployment/deploymentCenter.js";
import { InMemoryDeploymentIntentStore } from "../src/modules/deployment/store.js";
import { DeploymentExecutor } from "../src/modules/deployment/deploymentExecutor.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { ROLES, RISK_LEVELS } from "../src/shared/types.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function defaultFetchImpl() {
  return Promise.resolve(jsonResponse(200, { id: "dpl_fake123", url: "fake.vercel.app" }));
}

function makeRig({ fetchImpl } = {}) {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({ store: new InMemoryApprovalStore(), auditLog: logsCenter });
  const deploymentCenter = new DeploymentCenter({
    store: new InMemoryDeploymentIntentStore(),
    auditLog: logsCenter,
  });
  const executor = new DeploymentExecutor({
    deploymentCenter,
    approvalCenter,
    token: "fake-test-token",
    fetchImpl: fetchImpl ?? defaultFetchImpl,
  });
  return { logsCenter, approvalCenter, deploymentCenter, executor };
}

function makeApprovedRequest(approvalCenter) {
  const req = approvalCenter.createRequest({
    title: "Deploy to production",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  approvalCenter.approve(req.id, { by: ROLES.FOUNDER });
  return req;
}

test("constructor requires a token", () => {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({ store: new InMemoryApprovalStore(), auditLog: logsCenter });
  const deploymentCenter = new DeploymentCenter({ store: new InMemoryDeploymentIntentStore(), auditLog: logsCenter });
  assert.throws(() =>
    new DeploymentExecutor({ deploymentCenter, approvalCenter, token: "", fetchImpl: async () => {} })
  );
});

test("execute() requires an approvalRequestId", async () => {
  const { deploymentCenter, executor } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });

  await assert.rejects(() => executor.execute(intent.id, {}));
});

test("execute() refuses when the approval request is not APPROVED", async () => {
  const { deploymentCenter, approvalCenter, executor } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  const pendingReq = approvalCenter.createRequest({
    title: "Not yet approved",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });

  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: pendingReq.id }));
});

test("execute() refuses an intent with no project set, and marks it FAILED", async () => {
  const { deploymentCenter, approvalCenter, executor } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  const approved = makeApprovedRequest(approvalCenter);

  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: approved.id }));

  const failed = deploymentCenter.getById(intent.id);
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /no Vercel project set/);
});

test("execute() refuses to run an intent that isn't RECORDED", async () => {
  const { deploymentCenter, approvalCenter, executor } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  const approved = makeApprovedRequest(approvalCenter);
  await executor.execute(intent.id, { approvalRequestId: approved.id });

  const secondApproval = makeApprovedRequest(approvalCenter);
  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: secondApproval.id }));
});

test("execute() on an unknown intent id throws", async () => {
  const { approvalCenter, executor } = makeRig();
  const approved = makeApprovedRequest(approvalCenter);
  await assert.rejects(() => executor.execute("does-not-exist", { approvalRequestId: approved.id }));
});

test("success path: POSTs to /v13/deployments with target/gitSource derived from the intent, marks EXECUTED", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return jsonResponse(200, { id: "dpl_abc", url: "billing-service.vercel.app" });
  };
  const { deploymentCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  const approved = makeApprovedRequest(approvalCenter);

  const result = await executor.execute(intent.id, {
    approvalRequestId: approved.id,
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(result.status, "EXECUTED");
  assert.equal(result.result.id, "dpl_abc");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.vercel.com/v13/deployments");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    name: "billing-service",
    project: "billing-service",
    target: "production",
    gitSource: { type: "github", ref: "main" },
  });
});

test("non-production environment maps to Vercel's 'preview' target", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return jsonResponse(200, {});
  };
  const { deploymentCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = deploymentCenter.requestDeployment({
    environment: "staging",
    ref: "develop",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  const approved = makeApprovedRequest(approvalCenter);
  await executor.execute(intent.id, { approvalRequestId: approved.id });

  assert.equal(calls[0].target, "preview");
});

test("a non-ok Vercel API response marks the intent FAILED and rethrows", async () => {
  const fetchImpl = async () => jsonResponse(403, { error: { message: "Not authorized" } });
  const { deploymentCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  const approved = makeApprovedRequest(approvalCenter);

  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: approved.id }));

  const failed = deploymentCenter.getById(intent.id);
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /Not authorized/);
});

test("execution outcome is audited and joins the intent's causation chain via taskId", async () => {
  const { deploymentCenter, approvalCenter, executor, logsCenter } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
    taskId: "task-999",
  });
  const approved = makeApprovedRequest(approvalCenter);

  await executor.execute(intent.id, { approvalRequestId: approved.id, requestedBy: ROLES.CTO_AGENT });

  const chain = logsCenter.list({ refId: "task-999" });
  const actions = chain.map((e) => e.action);
  assert.ok(actions.includes("DEPLOYMENT_INTENT_RECORDED"));
  assert.ok(actions.includes("DEPLOYMENT_INTENT_EXECUTED"));
});

test("DeploymentCenter.markExecuted() cannot be called on an already-executed intent", () => {
  const { deploymentCenter } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    project: "billing-service",
  });
  deploymentCenter.markExecuted(intent.id, { status: "EXECUTED", result: {} });

  assert.throws(() => deploymentCenter.markExecuted(intent.id, { status: "EXECUTED", result: {} }));
});
