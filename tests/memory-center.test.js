import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryCenter } from "../src/modules/memory/memoryCenter.js";
import { InMemoryMemoryStore } from "../src/modules/memory/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const memoryCenter = new MemoryCenter({
    store: new InMemoryMemoryStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, memoryCenter };
}

test("remember() stores a new entry", () => {
  const { memoryCenter } = makeRig();
  const entry = memoryCenter.remember({
    key: "founder-preference",
    value: "prefers concise updates",
    requestedBy: ROLES.CEO_AGENT,
  });

  assert.equal(entry.key, "founder-preference");
  assert.equal(entry.value, "prefers concise updates");
  assert.deepEqual(entry.tags, []);
});

test("remember() requires key, value, requestedBy", () => {
  const { memoryCenter } = makeRig();
  assert.throws(() => memoryCenter.remember({ key: "x" }));
  assert.throws(() => memoryCenter.remember({ value: "x", requestedBy: ROLES.CEO_AGENT }));
});

test("remember() upserts by key rather than creating a duplicate", () => {
  const { memoryCenter } = makeRig();
  const first = memoryCenter.remember({
    key: "founder-preference",
    value: "v1",
    requestedBy: ROLES.CEO_AGENT,
  });
  const second = memoryCenter.remember({
    key: "founder-preference",
    value: "v2",
    requestedBy: ROLES.CEO_AGENT,
  });

  assert.equal(first.id, second.id);
  assert.equal(second.value, "v2");
  assert.equal(memoryCenter.list().length, 1);
});

test("recall() retrieves by key; getById() by id", () => {
  const { memoryCenter } = makeRig();
  const entry = memoryCenter.remember({ key: "k1", value: "v1", requestedBy: ROLES.CEO_AGENT });

  assert.equal(memoryCenter.recall("k1").id, entry.id);
  assert.equal(memoryCenter.recall("does-not-exist"), null);
  assert.equal(memoryCenter.getById(entry.id).key, "k1");
});

test("list() filters by taskId and tag", () => {
  const { memoryCenter } = makeRig();
  memoryCenter.remember({
    key: "k1",
    value: "v1",
    requestedBy: ROLES.CEO_AGENT,
    taskId: "task-1",
    tags: ["important"],
  });
  memoryCenter.remember({ key: "k2", value: "v2", requestedBy: ROLES.CEO_AGENT });

  assert.equal(memoryCenter.list({ taskId: "task-1" }).length, 1);
  assert.equal(memoryCenter.list({ tag: "important" }).length, 1);
  assert.equal(memoryCenter.list().length, 2);
});

test("remember() writes an audit entry and emits an event", () => {
  const { memoryCenter, logsCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.MEMORY_ENTRY_STORED, (e) => seen.push(e.key));

  memoryCenter.remember({ key: "k1", value: "v1", requestedBy: ROLES.CEO_AGENT });

  const entry = logsCenter.list({ module: "memory" })[0];
  assert.equal(entry.action, "MEMORY_ENTRY_STORED");
  assert.deepEqual(seen, ["k1"]);
});

test("taskId is propagated into audit details and joins the causation chain", () => {
  const { memoryCenter, logsCenter } = makeRig();
  memoryCenter.remember({
    key: "k1",
    value: "v1",
    requestedBy: ROLES.CEO_AGENT,
    taskId: "task-42",
  });

  const chain = logsCenter.list({ refId: "task-42" });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].action, "MEMORY_ENTRY_STORED");
  assert.equal(chain[0].module, "memory");
});
