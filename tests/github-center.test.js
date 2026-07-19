import { test } from "node:test";
import assert from "node:assert/strict";

import { GitHubCenter } from "../src/modules/github/githubCenter.js";
import { InMemoryGithubIntentStore } from "../src/modules/github/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const githubCenter = new GitHubCenter({
    store: new InMemoryGithubIntentStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, githubCenter };
}

test("requestBranchCreation() records an intent with status RECORDED, nothing more", () => {
  const { githubCenter } = makeRig();

  const intent = githubCenter.requestBranchCreation({
    repo: "billing-service",
    branch: "feature/rotate-key",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(intent.type, "CREATE_BRANCH");
  assert.equal(intent.status, "RECORDED");
  assert.equal(intent.repo, "billing-service");
  assert.equal(intent.branch, "feature/rotate-key");
  assert.equal(intent.baseBranch, "main");
});

test("requestBranchCreation() requires repo, branch, baseBranch, requestedBy", () => {
  const { githubCenter } = makeRig();
  assert.throws(() => githubCenter.requestBranchCreation({ repo: "x" }));
  assert.throws(() =>
    githubCenter.requestBranchCreation({ repo: "x", branch: "y", requestedBy: ROLES.CTO_AGENT })
  );
});

test("requestCommit() records an intent, does not require a real diff", () => {
  const { githubCenter } = makeRig();

  const intent = githubCenter.requestCommit({
    repo: "billing-service",
    branch: "feature/rotate-key",
    message: "Rotate signing key",
    requestedBy: ROLES.CTO_AGENT,
    filesChanged: ["config/keys.json"],
  });

  assert.equal(intent.type, "COMMIT");
  assert.equal(intent.status, "RECORDED");
  assert.deepEqual(intent.filesChanged, ["config/keys.json"]);
});

test("requestCommit() requires repo, branch, message, requestedBy", () => {
  const { githubCenter } = makeRig();
  assert.throws(() => githubCenter.requestCommit({ repo: "x", branch: "y" }));
});

test("requestPullRequest() records an intent", () => {
  const { githubCenter } = makeRig();

  const intent = githubCenter.requestPullRequest({
    repo: "billing-service",
    sourceBranch: "feature/rotate-key",
    targetBranch: "main",
    title: "Rotate signing key",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(intent.type, "OPEN_PULL_REQUEST");
  assert.equal(intent.status, "RECORDED");
});

test("requestPullRequest() requires repo, sourceBranch, targetBranch, title, requestedBy", () => {
  const { githubCenter } = makeRig();
  assert.throws(() =>
    githubCenter.requestPullRequest({ repo: "x", sourceBranch: "a", targetBranch: "b" })
  );
});

test("getById() and list() retrieve recorded intents", () => {
  const { githubCenter } = makeRig();
  const a = githubCenter.requestBranchCreation({
    repo: "repo-a",
    branch: "b1",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  githubCenter.requestCommit({
    repo: "repo-b",
    branch: "b2",
    message: "m",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(githubCenter.getById(a.id).id, a.id);
  assert.equal(githubCenter.getById("does-not-exist"), null);
  assert.equal(githubCenter.list({ repo: "repo-a" }).length, 1);
  assert.equal(githubCenter.list({ type: "COMMIT" }).length, 1);
  assert.equal(githubCenter.list().length, 2);
});

test("every intent action writes an audit log entry attributed to the correct module", () => {
  const { githubCenter, logsCenter } = makeRig();
  githubCenter.requestBranchCreation({
    repo: "repo-a",
    branch: "b1",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  githubCenter.requestCommit({
    repo: "repo-a",
    branch: "b1",
    message: "m",
    requestedBy: ROLES.CTO_AGENT,
  });
  githubCenter.requestPullRequest({
    repo: "repo-a",
    sourceBranch: "b1",
    targetBranch: "main",
    title: "t",
    requestedBy: ROLES.CTO_AGENT,
  });

  const entries = logsCenter.list({ module: "github" });
  assert.deepEqual(
    entries.map((e) => e.action),
    ["GITHUB_BRANCH_INTENT_RECORDED", "GITHUB_COMMIT_INTENT_RECORDED", "GITHUB_PR_INTENT_RECORDED"]
  );
});

test("intent events are emitted on the shared event bus", () => {
  const { githubCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.GITHUB_BRANCH_INTENT_RECORDED, (i) => seen.push(["BRANCH", i.id]));
  eventBus.on(EVENTS.GITHUB_COMMIT_INTENT_RECORDED, (i) => seen.push(["COMMIT", i.id]));

  const branch = githubCenter.requestBranchCreation({
    repo: "repo-a",
    branch: "b1",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });
  const commit = githubCenter.requestCommit({
    repo: "repo-a",
    branch: "b1",
    message: "m",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.deepEqual(seen, [
    ["BRANCH", branch.id],
    ["COMMIT", commit.id],
  ]);
});

test("taskId is propagated into audit details and refIds when provided, consistent with the rest of the framework", () => {
  const { githubCenter, logsCenter } = makeRig();
  githubCenter.requestCommit({
    repo: "repo-a",
    branch: "b1",
    message: "m",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-999",
  });

  const chain = logsCenter.list({ refId: "task-999" });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].action, "GITHUB_COMMIT_INTENT_RECORDED");
  assert.equal(chain[0].module, "github");
});

test("GitHub Center is isolated from real side effects: no network/fetch/exec surface exists on the instance", () => {
  const { githubCenter } = makeRig();
  // The boundary contract is deliberately narrow — proving the absence
  // of any execute/deploy/push/merge/network-shaped method is the
  // closest a unit test can get to proving "no real side effects."
  for (const forbidden of ["execute", "push", "merge", "fetch", "clone", "deploy", "authenticate"]) {
    assert.equal(typeof githubCenter[forbidden], "undefined", `unexpected method: ${forbidden}`);
  }
});

test("recorded intents never carry credentials or auth fields", () => {
  const { githubCenter } = makeRig();
  const intent = githubCenter.requestBranchCreation({
    repo: "repo-a",
    branch: "b1",
    baseBranch: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(intent.token, undefined);
  assert.equal(intent.credentials, undefined);
  assert.equal(intent.apiKey, undefined);
});
