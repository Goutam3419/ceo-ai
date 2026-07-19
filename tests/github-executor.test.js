import { test } from "node:test";
import assert from "node:assert/strict";

import { GitHubCenter } from "../src/modules/github/githubCenter.js";
import { InMemoryGithubIntentStore } from "../src/modules/github/store.js";
import { GithubExecutor } from "../src/modules/github/githubExecutor.js";
import { ApprovalCenter } from "../src/modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../src/modules/approval-center/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { ROLES, RISK_LEVELS } from "../src/shared/types.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function defaultFetchImpl(url, options) {
  const method = options?.method ?? "GET";
  if (method === "GET") {
    return Promise.resolve(jsonResponse(200, { object: { sha: "fake-sha" } }));
  }
  return Promise.resolve(jsonResponse(200, {}));
}

function makeRig({ fetchImpl } = {}) {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({
    store: new InMemoryApprovalStore(),
    auditLog: logsCenter,
  });
  const githubCenter = new GitHubCenter({
    store: new InMemoryGithubIntentStore(),
    auditLog: logsCenter,
  });
  const executor = new GithubExecutor({
    githubCenter,
    approvalCenter,
    token: "fake-test-token",
    fetchImpl: fetchImpl ?? defaultFetchImpl,
  });
  return { logsCenter, approvalCenter, githubCenter, executor };
}

function makeApprovedRequest(approvalCenter) {
  const req = approvalCenter.createRequest({
    title: "Do a GitHub thing",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  approvalCenter.approve(req.id, { by: ROLES.FOUNDER });
  return req;
}

test("constructor requires a token", () => {
  const logsCenter = new LogsCenter();
  const approvalCenter = new ApprovalCenter({ store: new InMemoryApprovalStore(), auditLog: logsCenter });
  const githubCenter = new GitHubCenter({ store: new InMemoryGithubIntentStore(), auditLog: logsCenter });
  assert.throws(() => new GithubExecutor({ githubCenter, approvalCenter, token: "", fetchImpl: async () => {} }));
});

test("execute() requires an approvalRequestId", async () => {
  const { githubCenter, executor } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  await assert.rejects(() => executor.execute(intent.id, {}));
});

test("execute() refuses when the approval request is not APPROVED", async () => {
  const { githubCenter, approvalCenter, executor } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  const pendingReq = approvalCenter.createRequest({
    title: "Not yet approved",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });

  await assert.rejects(() =>
    executor.execute(intent.id, { approvalRequestId: pendingReq.id })
  );
});

test("execute() refuses to run an intent that isn't RECORDED", async () => {
  const { githubCenter, approvalCenter, executor } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
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

test("CREATE_BRANCH: calls the ref lookup then the ref creation endpoint, and marks EXECUTED", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options?.method ?? "GET", body: options?.body });
    if (url.endsWith("/git/ref/heads/main")) {
      return jsonResponse(200, { object: { sha: "abc123" } });
    }
    if (url.endsWith("/git/refs")) {
      return jsonResponse(201, { ref: "refs/heads/feature/x" });
    }
    return jsonResponse(404, { message: "not found" });
  };
  const { githubCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  const approved = makeApprovedRequest(approvalCenter);

  const result = await executor.execute(intent.id, {
    approvalRequestId: approved.id,
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(result.status, "EXECUTED");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/billing-service/git/ref/heads/main");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body), { ref: "refs/heads/feature/x", sha: "abc123" });
});

test("COMMIT: refuses to execute without real file content", async () => {
  const { githubCenter, approvalCenter, executor } = makeRig();
  const intent = githubCenter.requestCommit({
    repo: "acme/billing-service",
    branch: "feature/x",
    message: "Rotate key",
    requestedBy: ROLES.CTO_AGENT,
  });
  const approved = makeApprovedRequest(approvalCenter);

  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: approved.id }));

  const failed = githubCenter.getById(intent.id);
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /no file content/);
});

test("COMMIT: with real files, PUTs base64-encoded content to the contents API", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options?.method, body: JSON.parse(options.body) });
    return jsonResponse(200, { content: { sha: "def456" } });
  };
  const { githubCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = githubCenter.requestCommit({
    repo: "acme/billing-service",
    branch: "feature/x",
    message: "Rotate key",
    requestedBy: ROLES.CTO_AGENT,
    files: [{ path: "config/keys.json", content: '{"rotated":true}' }],
  });
  const approved = makeApprovedRequest(approvalCenter);

  const result = await executor.execute(intent.id, { approvalRequestId: approved.id });

  assert.equal(result.status, "EXECUTED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/billing-service/contents/config/keys.json");
  assert.equal(calls[0].method, "PUT");
  assert.equal(
    Buffer.from(calls[0].body.content, "base64").toString("utf-8"),
    '{"rotated":true}'
  );
});

test("OPEN_PULL_REQUEST: POSTs to the pulls endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return jsonResponse(201, { number: 42 });
  };
  const { githubCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = githubCenter.requestPullRequest({
    repo: "acme/billing-service",
    sourceBranch: "feature/x",
    targetBranch: "main",
    title: "Rotate signing key",
    requestedBy: ROLES.CTO_AGENT,
  });
  const approved = makeApprovedRequest(approvalCenter);

  const result = await executor.execute(intent.id, { approvalRequestId: approved.id });

  assert.equal(result.status, "EXECUTED");
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/billing-service/pulls");
  assert.deepEqual(calls[0].body, { title: "Rotate signing key", head: "feature/x", base: "main" });
});

test("a non-ok GitHub API response marks the intent FAILED and rethrows", async () => {
  const fetchImpl = async () => jsonResponse(422, { message: "Reference already exists" });
  const { githubCenter, approvalCenter, executor } = makeRig({ fetchImpl });

  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  const approved = makeApprovedRequest(approvalCenter);

  await assert.rejects(() => executor.execute(intent.id, { approvalRequestId: approved.id }));

  const failed = githubCenter.getById(intent.id);
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /Reference already exists/);
});

test("execution outcome is audited and joins the intent's causation chain via taskId", async () => {
  const { githubCenter, approvalCenter, executor, logsCenter } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-555",
  });
  const approved = makeApprovedRequest(approvalCenter);

  await executor.execute(intent.id, { approvalRequestId: approved.id, requestedBy: ROLES.CTO_AGENT });

  const chain = logsCenter.list({ refId: "task-555" });
  const actions = chain.map((e) => e.action);
  assert.ok(actions.includes("GITHUB_BRANCH_INTENT_RECORDED"));
  assert.ok(actions.includes("GITHUB_INTENT_EXECUTED"));
});

test("GitHubCenter.markExecuted() cannot be called on an already-executed intent", () => {
  const { githubCenter } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "acme/billing-service",
    branch: "feature/x",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  githubCenter.markExecuted(intent.id, { status: "EXECUTED", result: {} });

  assert.throws(() => githubCenter.markExecuted(intent.id, { status: "EXECUTED", result: {} }));
});
