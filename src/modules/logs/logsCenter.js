import { randomUUID } from "node:crypto";
import { EVENTS } from "../../shared/types.js";

/**
 * Maps an action name's prefix to the module that owns it. Ordered
 * check, first match wins. New modules extend this list rather than
 * requiring callers to pass their own module name — every existing
 * caller (Approval Center, Review Queue, Task Board, CTO Agent) keeps
 * calling `record(actor, action, details)` unchanged.
 */
const ACTION_MODULE_RULES = [
  ["APPROVAL_", "approval-center"],
  ["REVIEW_ITEM_", "review-queue"],
  ["TASK_", "task-board"],
  ["CTO_", "cto-agent"],
  ["CEO_", "ceo-agent"],
  ["GITHUB_", "github"],
  ["DEPLOYMENT_", "deployment"],
  ["MEMORY_", "memory"],
  ["DOCUMENT_", "documents"],
  ["PROVIDER_", "providers"],
  ["SETTING_", "settings"],
];

function inferModule(action) {
  for (const [prefix, moduleName] of ACTION_MODULE_RULES) {
    if (action.startsWith(prefix)) return moduleName;
  }
  return "unknown";
}

/**
 * Pulls causation links out of a details object: any key ending in
 * "Id" whose value is a string is treated as a reference to a related
 * entity (e.g. taskId, requestId, itemId, approvalRequestId). This is
 * how entries from different modules that concern the same underlying
 * task/request/review get tied together without each module needing
 * to know about Logs Center's schema.
 */
function extractRefIds(details) {
  const ids = [];
  for (const [key, value] of Object.entries(details ?? {})) {
    if (key.endsWith("Id") && typeof value === "string") {
      ids.push(value);
    }
  }
  return ids;
}

/**
 * LogsCenter — real module, fifth in the framework.
 *
 * Drop-in compatible with the minimal AuditLog it supersedes as the
 * app shell's audit dependency: same `record(actor, action, details)`
 * call signature, so Approval Center / Review Queue / Task Board /
 * CTO Agent require no changes to use it. Adds real query behavior
 * (filter by module/action/actor/causation id) on top.
 *
 * Storage is in-memory only. No UI, no external persistence — both
 * explicitly out of scope for this milestone.
 */
export class LogsCenter {
  /**
   * @param {{eventBus?: import('../../shared/eventBus.js').EventBus}} [deps]
   */
  constructor({ eventBus = null } = {}) {
    /** @type {import('../../shared/types.js').LogEntry[]} */
    this._entries = [];
    this._eventBus = eventBus;
  }

  /**
   * Rehydrate a single already-built log entry directly (used only by
   * the persistence layer to restore state on startup — normal
   * runtime code should always use record(), never this). Distinct
   * from record(): this does not generate a new id/timestamp or infer
   * anything, it just re-inserts an entry exactly as it was saved.
   * @param {import('../../shared/types.js').LogEntry} entry
   */
  save(entry) {
    this._entries.push(entry);
    return entry;
  }

  /**
   * @param {string} actor - role from ROLES
   * @param {string} action
   * @param {Object} [details]
   * @returns {import('../../shared/types.js').LogEntry}
   */
  record(actor, action, details = {}) {
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      module: inferModule(action),
      action,
      details,
      refIds: extractRefIds(details),
    };
    this._entries.push(entry);
    this._emit(EVENTS.LOG_RECORDED, entry);
    return entry;
  }

  /** @param {string} id */
  getById(id) {
    return this._entries.find((e) => e.id === id) ?? null;
  }

  /**
   * @param {{module?: string, action?: string, actor?: string, refId?: string}} [filter]
   * @returns {import('../../shared/types.js').LogEntry[]}
   */
  list(filter = {}) {
    let all = [...this._entries];
    if (filter.module) all = all.filter((e) => e.module === filter.module);
    if (filter.action) all = all.filter((e) => e.action === filter.action);
    if (filter.actor) all = all.filter((e) => e.actor === filter.actor);
    if (filter.refId) all = all.filter((e) => e.refIds.includes(filter.refId));
    return all;
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
