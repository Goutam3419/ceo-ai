/**
 * Logs Center — REAL module.
 *
 * `LogsCenter` is the real implementation and is what the app shell
 * wires as the shared audit dependency for Approval Center, Review
 * Queue, Task Board, and CTO Agent. It records every `record(actor,
 * action, details)` call those modules already make, infers which
 * module owns each action, and extracts causation links (refIds) from
 * the details each caller was already passing — no changes required
 * to any of the four calling modules.
 *
 * `AuditLog` (the older, minimal logger) is kept and still exported
 * for backward compatibility — the approval-center/review-queue/
 * task-board/cto-agent test suites construct it directly and continue
 * to pass unchanged. New code should prefer `LogsCenter`.
 */
import { LogsCenter } from "./logsCenter.js";

export { LogsCenter } from "./logsCenter.js";
export { AuditLog } from "./auditLog.js";

export function createLogsCenter(deps = {}) {
  return new LogsCenter({ eventBus: deps.eventBus ?? null });
}

export const boundary = Object.freeze({
  module: "logs",
  status: "REAL", // fifth fully implemented module
  implemented: [
    "record() — same signature as the legacy AuditLog it supersedes",
    "list() — filter by module/action/actor/refId (causation link)",
    "getById()",
    "module inference from action name",
    "causation-link extraction (refIds) from details",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "retention policy",
    "log viewer / search UI",
  ],
});
