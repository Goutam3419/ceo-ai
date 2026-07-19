import { test } from "node:test";
import assert from "node:assert/strict";

import { SettingsCenter } from "../src/modules/settings/settingsCenter.js";
import { InMemorySettingsStore } from "../src/modules/settings/store.js";
import { LogsCenter } from "../src/modules/logs/logsCenter.js";
import { EventBus } from "../src/shared/eventBus.js";
import { ROLES, EVENTS } from "../src/shared/types.js";

function makeRig() {
  const logsCenter = new LogsCenter();
  const eventBus = new EventBus();
  const settingsCenter = new SettingsCenter({
    store: new InMemorySettingsStore(),
    auditLog: logsCenter,
    eventBus,
  });
  return { logsCenter, eventBus, settingsCenter };
}

test("setSetting() stores a key/value pair", () => {
  const { settingsCenter } = makeRig();
  const setting = settingsCenter.setSetting({
    key: "max_pending_approvals",
    value: 10,
    requestedBy: ROLES.FOUNDER,
  });

  assert.equal(setting.key, "max_pending_approvals");
  assert.equal(setting.value, 10);
  assert.equal(setting.updatedBy, ROLES.FOUNDER);
});

test("setSetting() requires key, value, requestedBy", () => {
  const { settingsCenter } = makeRig();
  assert.throws(() => settingsCenter.setSetting({ key: "x" }));
});

test("setSetting() upserts: calling again with the same key overwrites the value", () => {
  const { settingsCenter } = makeRig();
  settingsCenter.setSetting({ key: "feature_flag", value: false, requestedBy: ROLES.FOUNDER });
  const updated = settingsCenter.setSetting({
    key: "feature_flag",
    value: true,
    requestedBy: ROLES.FOUNDER,
  });

  assert.equal(updated.value, true);
  assert.equal(settingsCenter.list().length, 1);
});

test("getSetting() retrieves by key; list() returns all settings", () => {
  const { settingsCenter } = makeRig();
  settingsCenter.setSetting({ key: "k1", value: "v1", requestedBy: ROLES.FOUNDER });
  settingsCenter.setSetting({ key: "k2", value: "v2", requestedBy: ROLES.FOUNDER });

  assert.equal(settingsCenter.getSetting("k1").value, "v1");
  assert.equal(settingsCenter.getSetting("does-not-exist"), null);
  assert.equal(settingsCenter.list().length, 2);
});

test("setSetting() writes an audit entry and emits an event", () => {
  const { settingsCenter, logsCenter, eventBus } = makeRig();
  const seen = [];
  eventBus.on(EVENTS.SETTING_UPDATED, (s) => seen.push(s.key));

  settingsCenter.setSetting({ key: "k1", value: "v1", requestedBy: ROLES.FOUNDER });

  const entry = logsCenter.list({ module: "settings" })[0];
  assert.equal(entry.action, "SETTING_UPDATED");
  assert.deepEqual(seen, ["k1"]);
});
