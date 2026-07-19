import { test } from "node:test";
import assert from "node:assert/strict";

import { FirebaseSnapshot } from "../src/persistence/firebaseSnapshot.js";
import { createAppShell } from "../src/app/shell.js";
import { ROLES, RISK_LEVELS } from "../src/shared/types.js";

/**
 * A minimal fake Firestore-shaped db: one in-memory "document" per
 * path, supporting exactly the get()/set() shape FirebaseSnapshot
 * uses. This is enough to prove the export/import logic works
 * correctly without ever touching a real Firebase project.
 */
function makeFakeDb() {
  const documents = new Map();
  return {
    doc(path) {
      return {
        async get() {
          const data = documents.get(path);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        async set(data) {
          documents.set(path, data);
        },
      };
    },
    _documents: documents,
  };
}

test("constructor requires a Firestore-shaped db", () => {
  assert.throws(() => new FirebaseSnapshot({ db: null }));
  assert.throws(() => new FirebaseSnapshot({ db: {} }));
});

test("save() writes every store's list() output into one document", async () => {
  const db = makeFakeDb();
  const snapshot = new FirebaseSnapshot({ db });

  const storeA = { list: () => [{ id: "a1" }, { id: "a2" }] };
  const storeB = { list: () => [{ id: "b1" }] };

  const state = await snapshot.save({ storeA, storeB });

  assert.deepEqual(state, {
    storeA: [{ id: "a1" }, { id: "a2" }],
    storeB: [{ id: "b1" }],
  });

  const raw = await db.doc("ai-company-os/state").get();
  assert.ok(raw.exists);
  assert.deepEqual(raw.data().state, state);
  assert.ok(raw.data().savedAt);
});

test("load() returns false and does nothing when no snapshot has ever been saved", async () => {
  const db = makeFakeDb();
  const snapshot = new FirebaseSnapshot({ db });

  const saved = [];
  const storeA = { save: (r) => saved.push(r) };

  const loaded = await snapshot.load({ storeA });

  assert.equal(loaded, false);
  assert.deepEqual(saved, []);
});

test("save() then load() round-trips records back into fresh stores", async () => {
  const db = makeFakeDb();
  const snapshot = new FirebaseSnapshot({ db });

  const originalRecords = { storeA: [{ id: "a1" }, { id: "a2" }] };
  await snapshot.save({
    storeA: { list: () => originalRecords.storeA },
  });

  const rehydrated = [];
  const freshStoreA = { save: (r) => rehydrated.push(r) };
  const loaded = await snapshot.load({ storeA: freshStoreA });

  assert.equal(loaded, true);
  assert.deepEqual(rehydrated, originalRecords.storeA);
});

test("load() skips a store name in the snapshot that no longer exists in the current stores map", async () => {
  const db = makeFakeDb();
  const snapshot = new FirebaseSnapshot({ db });

  await snapshot.save({ storeA: { list: () => [{ id: "a1" }] } });

  // storeA is missing this time — should not throw.
  await assert.doesNotReject(() => snapshot.load({ storeB: { save: () => {} } }));
});

test("full integration: a real app shell's state round-trips through FirebaseSnapshot", async () => {
  const db = makeFakeDb();
  const snapshot = new FirebaseSnapshot({ db });

  const shell = createAppShell();
  const plan = shell.ceoAgent.intakeGoal({ title: "Rotate infra credentials", steps: ["Rotate signing key"] });
  const [task] = shell.ceoAgent.createTasksFromPlan(plan.id);
  shell.ctoAgent.acceptTask(task.id);
  const req = shell.approvalCenter.createRequest({
    title: "Deploy hotfix",
    requestedBy: ROLES.CEO_AGENT,
    riskLevel: RISK_LEVELS.HIGH,
  });
  shell.approvalCenter.approve(req.id, { by: ROLES.FOUNDER });

  await snapshot.save(shell.stores);

  // A brand new shell, as if the process had restarted with nothing
  // in memory.
  const freshShell = createAppShell();
  assert.equal(freshShell.taskBoard.list().length, 0);

  const loaded = await snapshot.load(freshShell.stores);
  assert.equal(loaded, true);

  assert.equal(freshShell.taskBoard.list().length, 1);
  assert.equal(freshShell.taskBoard.getById(task.id).title, task.title);
  assert.equal(freshShell.approvalCenter.getById(req.id).status, "APPROVED");
  assert.ok(freshShell.logsCenter.list().length > 0);
});
