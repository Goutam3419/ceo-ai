import { test } from "node:test";
import assert from "node:assert/strict";

import { DocumentsCenter } from "../src/modules/documents/documentsCenter.js";
import { InMemoryDocumentStore } from "../src/modules/documents/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const documentsCenter = new DocumentsCenter({
    store: new InMemoryDocumentStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, documentsCenter };
}

test("createDocument() starts at version 1 with a history entry", () => {
  const { documentsCenter } = makeRig();
  const doc = documentsCenter.createDocument({
    title: "Runbook",
    content: "Step 1: ...",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(doc.version, 1);
  assert.equal(doc.history.length, 1);
  assert.equal(doc.history[0].version, 1);
});

test("createDocument() requires title, content, requestedBy", () => {
  const { documentsCenter } = makeRig();
  assert.throws(() => documentsCenter.createDocument({ title: "x" }));
});

test("updateDocument() increments version and appends history", () => {
  const { documentsCenter } = makeRig();
  const doc = documentsCenter.createDocument({
    title: "Runbook",
    content: "v1",
    requestedBy: ROLES.CTO_AGENT,
  });

  const updated = documentsCenter.updateDocument(doc.id, {
    content: "v2",
    requestedBy: ROLES.CTO_AGENT,
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.content, "v2");
  assert.equal(updated.history.length, 2);
});

test("updateDocument() on an unknown id throws", () => {
  const { documentsCenter } = makeRig();
  assert.throws(() =>
    documentsCenter.updateDocument("does-not-exist", { content: "x", requestedBy: ROLES.CTO_AGENT })
  );
});

test("getById() and list() retrieve documents, filterable by taskId", () => {
  const { documentsCenter } = makeRig();
  const doc = documentsCenter.createDocument({
    title: "A",
    content: "c",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-1",
  });
  documentsCenter.createDocument({ title: "B", content: "c", requestedBy: ROLES.CTO_AGENT });

  assert.equal(documentsCenter.getById(doc.id).title, "A");
  assert.equal(documentsCenter.list({ taskId: "task-1" }).length, 1);
  assert.equal(documentsCenter.list().length, 2);
});

test("createDocument()/updateDocument() write audit entries and emit events", () => {
  const { documentsCenter, logsCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.DOCUMENT_CREATED, (d) => seen.push(["CREATED", d.version]));
  eventBus.on(EVENTS.DOCUMENT_UPDATED, (d) => seen.push(["UPDATED", d.version]));

  const doc = documentsCenter.createDocument({
    title: "Runbook",
    content: "v1",
    requestedBy: ROLES.CTO_AGENT,
  });
  documentsCenter.updateDocument(doc.id, { content: "v2", requestedBy: ROLES.CTO_AGENT });

  const actions = logsCenter.list({ module: "documents" }).map((e) => e.action);
  assert.deepEqual(actions, ["DOCUMENT_CREATED", "DOCUMENT_UPDATED"]);
  assert.deepEqual(seen, [
    ["CREATED", 1],
    ["UPDATED", 2],
  ]);
});

test("taskId is propagated into audit details and joins the causation chain across versions", () => {
  const { documentsCenter, logsCenter } = makeRig();
  const doc = documentsCenter.createDocument({
    title: "Runbook",
    content: "v1",
    requestedBy: ROLES.CTO_AGENT,
    taskId: "task-99",
  });
  documentsCenter.updateDocument(doc.id, { content: "v2", requestedBy: ROLES.CTO_AGENT });

  const chain = logsCenter.list({ refId: "task-99" });
  assert.equal(chain.length, 2);
  assert.deepEqual(
    chain.map((e) => e.action),
    ["DOCUMENT_CREATED", "DOCUMENT_UPDATED"]
  );
});
