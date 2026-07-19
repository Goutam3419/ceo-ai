import { ProvidersCenter } from "./providersCenter.js";
import { InMemoryProviderStore, InMemoryProviderAssignmentStore } from "./store.js";

export { ProvidersCenter } from "./providersCenter.js";
export { InMemoryProviderStore, InMemoryProviderAssignmentStore } from "./store.js";

/**
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createProvidersCenter(deps) {
  return new ProvidersCenter({
    providerStore: new InMemoryProviderStore(),
    assignmentStore: new InMemoryProviderAssignmentStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

export const boundary = Object.freeze({
  module: "providers",
  status: "REAL",
  implemented: [
    "registerProvider()",
    "assignProviderToRole() — validates role against ROLES; roles ≠ providers",
    "getAssignmentForRole() — most recent assignment",
    "getProviderById() / listProviders() / listAssignments()",
  ],
  notImplemented: [
    "persistence beyond process memory",
    "provider health checks / availability",
    "cost or usage tracking",
  ],
  note: "Real internal storage. Explicitly enforces the roles-are-permanent / providers-can-change rule at assignment time.",
});
