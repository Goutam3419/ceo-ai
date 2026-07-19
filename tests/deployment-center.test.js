import { test } from "node:test";
import assert from "node:assert/strict";

import { DeploymentCenter } from "../src/modules/deployment/deploymentCenter.js";
import { InMemoryDeploymentIntentStore } from "../src/modules/deployment/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const deploymentCenter = new DeploymentCenter({
    store: new InMemoryDeploymentIntentStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, deploymentCenter };
}

test("requestDeployment() records an intent with status RECORDED, nothing more", () => {
  const { deploymentCenter } = makeRig();

  const intent = deploymentCenter.requestDeployment({
    environment: "staging",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(intent.type, "DEPLOY");
  assert.equal(intent.status, "RECORDED");
  assert.equal(intent.environment, "staging");
  assert.equal(intent.ref, "main");
  assert.equal(intent.requestedBy, ROLES.CTO_AGENT);
  assert.equal(intent.taskId, null);
});

test("requestDeployment() requires environment, ref, requestedBy", () => {
  const { deploymentCenter } = makeRig();
  assert.throws(() => deploymentCenter.requestDeployment({ environment: "staging" }));
  assert.throws(() => deploymentCenter.requestDeployment({ ref: "main" }));
  assert.throws(() =>
    deploymentCenter.requestDeployment({ environment: "staging", ref: "main" })
  );
});

test("getById() and list() retrieve recorded intents, filterable by environment and taskId", () => {
  const { deploymentCenter } = makeRig();
  const a = deploymentCenter.requestDeployment({
    environment: "staging",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-1",
  });
  deploymentCenter.requestDeployment({
    environment: "production",
    ref: "v1.2.0",
    requestedBy: ROLES.FOUNDER,
  });

  assert.equal(deploymentCenter.getById(a.id).id, a.id);
  assert.equal(deploymentCenter.getById("does-not-exist"), null);
  assert.equal(deploymentCenter.list({ environment: "staging" }).length, 1);
  assert.equal(deploymentCenter.list({ taskId: "task-1" }).length, 1);
  assert.equal(deploymentCenter.list().length, 2);
});

test("requestDeployment() writes an audit log entry attributed to the deployment module", () => {
  const { deploymentCenter, logsCenter } = makeRig();
  deploymentCenter.requestDeployment({
    environment: "production",
    ref: "v2.0.0",
    requestedBy: ROLES.CEO_AGENT,
  });

  const entries = logsCenter.list({ module: "deployment" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "DEPLOYMENT_INTENT_RECORDED");
  assert.equal(entries[0].details.environment, "production");
  assert.equal(entries[0].details.ref, "v2.0.0");
});

test("a DEPLOYMENT_INTENT_RECORDED event is emitted on the shared event bus", () => {
  const { deploymentCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.DEPLOYMENT_INTENT_RECORDED, (i) => seen.push(i.id));

  const intent = deploymentCenter.requestDeployment({
    environment: "staging",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.deepEqual(seen, [intent.id]);
});

test("taskId is propagated into audit details and refIds when provided, joining the causation chain", () => {
  const { deploymentCenter, logsCenter } = makeRig();
  deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-777",
  });

  const chain = logsCenter.list({ refId: "task-777" });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].action, "DEPLOYMENT_INTENT_RECORDED");
  assert.equal(chain[0].module, "deployment");
});

test("taskId omitted cleanly when not provided", () => {
  const { deploymentCenter, logsCenter } = makeRig();
  deploymentCenter.requestDeployment({
    environment: "staging",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  const entry = logsCenter.list({ action: "DEPLOYMENT_INTENT_RECORDED" })[0];
  assert.equal(entry.details.taskId, undefined);
});

test("Deployment Center is isolated from real side effects: no network/execute/rollout surface exists on the instance", () => {
  const { deploymentCenter } = makeRig();
  for (const forbidden of [
    "execute",
    "deploy",
    "publish",
    "rollout",
    "rollback",
    "fetch",
    "authenticate",
  ]) {
    assert.equal(typeof deploymentCenter[forbidden], "undefined", `unexpected method: ${forbidden}`);
  }
});

test("recorded intents never carry credentials or auth fields", () => {
  const { deploymentCenter } = makeRig();
  const intent = deploymentCenter.requestDeployment({
    environment: "production",
    ref: "main",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(intent.token, undefined);
  assert.equal(intent.credentials, undefined);
  assert.equal(intent.apiKey, undefined);
});
