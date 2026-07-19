import { test } from "node:test";
import assert from "node:assert/strict";

import { ProvidersCenter } from "../src/modules/providers/providersCenter.js";
import { InMemoryProviderStore, InMemoryProviderAssignmentStore } from "../src/modules/providers/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const providersCenter = new ProvidersCenter({
    providerStore: new InMemoryProviderStore(),
    assignmentStore: new InMemoryProviderAssignmentStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, providersCenter };
}

test("registerProvider() creates a provider record", () => {
  const { providersCenter } = makeRig();
  const provider = providersCenter.registerProvider({
    name: "claude-sonnet-5",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });

  assert.ok(provider.id);
  assert.equal(provider.name, "claude-sonnet-5");
  assert.equal(provider.type, "llm");
});

test("registerProvider() requires name, type, requestedBy", () => {
  const { providersCenter } = makeRig();
  assert.throws(() => providersCenter.registerProvider({ name: "x" }));
});

test("assignProviderToRole() links a registered provider to a permanent role", () => {
  const { providersCenter } = makeRig();
  const provider = providersCenter.registerProvider({
    name: "claude-sonnet-5",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });

  const assignment = providersCenter.assignProviderToRole({
    role: ROLES.CEO_AGENT,
    providerId: provider.id,
    requestedBy: ROLES.FOUNDER,
  });

  assert.equal(assignment.role, ROLES.CEO_AGENT);
  assert.equal(assignment.providerId, provider.id);
});

test("assignProviderToRole() rejects a role that isn't one of the permanent ROLES", () => {
  const { providersCenter } = makeRig();
  const provider = providersCenter.registerProvider({
    name: "claude-sonnet-5",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });

  assert.throws(() =>
    providersCenter.assignProviderToRole({
      role: "claude-sonnet-5", // a provider name, not a role — must be rejected
      providerId: provider.id,
      requestedBy: ROLES.FOUNDER,
    })
  );
  assert.throws(() =>
    providersCenter.assignProviderToRole({
      role: "NOT_A_REAL_ROLE",
      providerId: provider.id,
      requestedBy: ROLES.FOUNDER,
    })
  );
});

test("assignProviderToRole() rejects an unregistered providerId", () => {
  const { providersCenter } = makeRig();
  assert.throws(() =>
    providersCenter.assignProviderToRole({
      role: ROLES.CEO_AGENT,
      providerId: "does-not-exist",
      requestedBy: ROLES.FOUNDER,
    })
  );
});

test("getAssignmentForRole() returns the most recent assignment for a role", () => {
  const { providersCenter } = makeRig();
  const providerA = providersCenter.registerProvider({
    name: "provider-a",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });
  const providerB = providersCenter.registerProvider({
    name: "provider-b",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });

  providersCenter.assignProviderToRole({
    role: ROLES.CTO_AGENT,
    providerId: providerA.id,
    requestedBy: ROLES.FOUNDER,
  });
  providersCenter.assignProviderToRole({
    role: ROLES.CTO_AGENT,
    providerId: providerB.id,
    requestedBy: ROLES.FOUNDER,
  });

  const current = providersCenter.getAssignmentForRole(ROLES.CTO_AGENT);
  assert.equal(current.providerId, providerB.id);
  assert.equal(providersCenter.listAssignments({ role: ROLES.CTO_AGENT }).length, 2);
});

test("getAssignmentForRole() returns null when no assignment exists", () => {
  const { providersCenter } = makeRig();
  assert.equal(providersCenter.getAssignmentForRole(ROLES.PM), null);
});

test("registerProvider()/assignProviderToRole() write audit entries and emit events", () => {
  const { providersCenter, logsCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.PROVIDER_REGISTERED, (p) => seen.push(["REGISTERED", p.name]));
  eventBus.on(EVENTS.PROVIDER_ASSIGNED_TO_ROLE, (a) => seen.push(["ASSIGNED", a.role]));

  const provider = providersCenter.registerProvider({
    name: "claude-sonnet-5",
    type: "llm",
    requestedBy: ROLES.FOUNDER,
  });
  providersCenter.assignProviderToRole({
    role: ROLES.CEO_AGENT,
    providerId: provider.id,
    requestedBy: ROLES.FOUNDER,
  });

  const actions = logsCenter.list({ module: "providers" }).map((e) => e.action);
  assert.deepEqual(actions, ["PROVIDER_REGISTERED", "PROVIDER_ASSIGNED_TO_ROLE"]);
  assert.deepEqual(seen, [
    ["REGISTERED", "claude-sonnet-5"],
    ["ASSIGNED", ROLES.CEO_AGENT],
  ]);
});

test("listProviders() and getProviderById() work as expected", () => {
  const { providersCenter } = makeRig();
  const a = providersCenter.registerProvider({ name: "a", type: "llm", requestedBy: ROLES.FOUNDER });
  providersCenter.registerProvider({ name: "b", type: "image", requestedBy: ROLES.FOUNDER });

  assert.equal(providersCenter.listProviders().length, 2);
  assert.equal(providersCenter.listProviders({ type: "llm" }).length, 1);
  assert.equal(providersCenter.getProviderById(a.id).name, "a");
});
