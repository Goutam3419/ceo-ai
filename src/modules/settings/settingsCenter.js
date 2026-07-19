import { EVENTS } from "../../shared/types.js";

/**
 * SettingsCenter — real module.
 *
 * The smallest possible surface: app-level configuration as key/value
 * pairs. Same "real internal storage, no external-provider boundary"
 * shape as Memory Center and Documents Center. `setSetting()` upserts
 * — there's no separate create/update distinction, since a setting is
 * just "the current value under this key."
 */
export class SettingsCenter {
  /**
   * @param {{store: import('./store.js').InMemorySettingsStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * @param {{key: string, value: *, requestedBy: string}} input
   * @returns {import('../../shared/types.js').Setting}
   */
  setSetting(input) {
    if (!input || !input.key || input.value === undefined || !input.requestedBy) {
      throw new Error("SettingsCenter.setSetting requires: key, value, requestedBy");
    }

    /** @type {import('../../shared/types.js').Setting} */
    const setting = {
      key: input.key,
      value: input.value,
      updatedBy: input.requestedBy,
      updatedAt: new Date().toISOString(),
    };

    this._store.save(setting);
    this._auditLog.record(input.requestedBy, "SETTING_UPDATED", { key: setting.key });
    this._emit(EVENTS.SETTING_UPDATED, setting);

    return setting;
  }

  /** @param {string} key */
  getSetting(key) {
    return this._store.getByKey(key);
  }

  list() {
    return this._store.list();
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
