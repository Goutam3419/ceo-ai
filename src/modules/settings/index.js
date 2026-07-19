import { SettingsCenter } from "./settingsCenter.js";
import { InMemorySettingsStore } from "./store.js";

export { SettingsCenter } from "./settingsCenter.js";
export { InMemorySettingsStore } from "./store.js";

/**
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createSettingsCenter(deps) {
  return new SettingsCenter({
    store: new InMemorySettingsStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "settings",
  status: "REAL",
  implemented: ["setSetting() — upsert", "getSetting()", "list()"],
  notImplemented: [
    "persistence beyond process memory",
    "typed/validated settings schema",
    "per-environment overrides",
  ],
  note: "Real internal storage, not a boundary to an external provider.",
});
