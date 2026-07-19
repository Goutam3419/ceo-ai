/**
 * In-memory persistence for settings, keyed directly by setting key
 * (settings are naturally key-addressed, unlike the other modules'
 * id-addressed records).
 */
export class InMemorySettingsStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').Setting>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').Setting} setting */
  save(setting) {
    this._records.set(setting.key, setting);
    return setting;
  }

  /** @param {string} key */
  getByKey(key) {
    return this._records.get(key) ?? null;
  }

  list() {
    return [...this._records.values()];
  }
}
