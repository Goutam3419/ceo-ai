import { randomUUID } from "node:crypto";
import { ROLES, EVENTS } from "../../shared/types.js";

const VALID_ROLES = new Set(Object.values(ROLES));

/**
 * ProvidersCenter — real module.
 *
 * Encodes the framework's core, permanent rule directly: roles
 * (FOUNDER, CEO_AGENT, CTO_AGENT, PM) are fixed and never change;
 * providers (which vendor/model powers a role) are a separate,
 * swappable concept. `assignProviderToRole()` is the explicit mapping
 * between the two — it validates the role against ROLES (never
 * accepts an arbitrary string as if it were a role) and validates the
 * provider was actually registered first. It never redefines what a
 * role is; it only records which provider currently backs one.
 *
 * Assignments are additive history, not overwrites — each call adds a
 * new assignment record. `getAssignmentForRole()` returns the most
 * recent one, so "current" provider is derived, not a separate field
 * that could drift out of sync with history.
 */
export class ProvidersCenter {
  /**
   * @param {{providerStore: import('./store.js').InMemoryProviderStore, assignmentStore: import('./store.js').InMemoryProviderAssignmentStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ providerStore, assignmentStore, auditLog, eventBus = null }) {
    this._providerStore = providerStore;
    this._assignmentStore = assignmentStore;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * @param {{name: string, type: string, requestedBy: string}} input
   * @returns {import('../../shared/types.js').Provider}
   */
  registerProvider(input) {
    if (!input || !input.name || !input.type || !input.requestedBy) {
      throw new Error("ProvidersCenter.registerProvider requires: name, type, requestedBy");
    }

    /** @type {import('../../shared/types.js').Provider} */
    const provider = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      createdAt: new Date().toISOString(),
    };

    this._providerStore.save(provider);
    this._auditLog.record(input.requestedBy, "PROVIDER_REGISTERED", {
      name: provider.name,
      type: provider.type,
    });
    this._emit(EVENTS.PROVIDER_REGISTERED, provider);

    return provider;
  }

  /**
   * @param {{role: string, providerId: string, requestedBy: string}} input
   * @returns {import('../../shared/types.js').ProviderAssignment}
   */
  assignProviderToRole(input) {
    if (!input || !input.role || !input.providerId || !input.requestedBy) {
      throw new Error("ProvidersCenter.assignProviderToRole requires: role, providerId, requestedBy");
    }
    if (!VALID_ROLES.has(input.role)) {
      throw new Error(
        `ProvidersCenter.assignProviderToRole: "${input.role}" is not a permanent role. Roles and providers are different — a provider cannot be assigned to something that isn't one of ROLES.`
      );
    }
    if (!this._providerStore.getById(input.providerId)) {
      throw new Error(`ProvidersCenter.assignProviderToRole: provider not found: ${input.providerId}`);
    }

    /** @type {import('../../shared/types.js').ProviderAssignment} */
    const assignment = {
      id: randomUUID(),
      role: input.role,
      providerId: input.providerId,
      requestedBy: input.requestedBy,
      assignedAt: new Date().toISOString(),
    };

    this._assignmentStore.save(assignment);
    this._auditLog.record(input.requestedBy, "PROVIDER_ASSIGNED_TO_ROLE", {
      role: assignment.role,
      providerId: assignment.providerId,
    });
    this._emit(EVENTS.PROVIDER_ASSIGNED_TO_ROLE, assignment);

    return assignment;
  }

  /**
   * Returns the most recently assigned provider for a role. Uses
   * insertion order (guaranteed by the Map-backed store) rather than
   * comparing assignedAt timestamps, since two assignments made in
   * the same synchronous call sequence can share the same millisecond
   * timestamp — insertion order is unambiguous, timestamp equality
   * isn't.
   * @param {string} role
   */
  getAssignmentForRole(role) {
    const assignments = this._assignmentStore.list({ role });
    return assignments[assignments.length - 1] ?? null;
  }

  /** @param {string} id */
  getProviderById(id) {
    return this._providerStore.getById(id);
  }

  /** @param {{type?: string}} [filter] */
  listProviders(filter) {
    return this._providerStore.list(filter);
  }

  /** @param {{role?: string}} [filter] */
  listAssignments(filter) {
    return this._assignmentStore.list(filter);
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
