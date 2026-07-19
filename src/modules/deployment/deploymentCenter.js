import { randomUUID } from "node:crypto";
import { EVENTS } from "../../shared/types.js";

/**
 * DeploymentCenter — BOUNDARY module, real internally, real deploys
 * only through a separate, approval-gated executor.
 *
 * Smallest useful surface for a deployment boundary: a single typed
 * method, `requestDeployment()`, representing a request to deploy or
 * publish the current state to an environment. It only *records
 * intent* here — no deployment provider client, no credentials, no
 * network call.
 *
 * A real deployment only happens if a separate `DeploymentExecutor`
 * (see deploymentExecutor.js) is invoked with a RECORDED intent's id
 * AND proof of an APPROVED approval request. `markExecuted()` is how
 * the executor reports back — same pattern as GitHub Center /
 * GithubExecutor.
 *
 * Deliberately does not model rollback, environment promotion, or
 * multi-stage pipelines — those are architecture decisions for a real
 * provider integration, not this boundary layer.
 */
export class DeploymentCenter {
  /**
   * @param {{store: import('./store.js').InMemoryDeploymentIntentStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * Record intent to deploy/publish. Does not deploy anything.
   * `project` (Vercel project name/id) is optional at recording time,
   * but required for DeploymentExecutor to actually trigger a deploy
   * later — without it there's nothing to target.
   * @param {{environment: string, ref: string, requestedBy: string, taskId?: string, note?: string, project?: string}} input
   * @returns {import('../../shared/types.js').DeploymentIntent}
   */
  requestDeployment(input) {
    if (!input || !input.environment || !input.ref || !input.requestedBy) {
      throw new Error(
        "DeploymentCenter.requestDeployment requires: environment, ref, requestedBy"
      );
    }

    /** @type {import('../../shared/types.js').DeploymentIntent} */
    const intent = {
      id: randomUUID(),
      type: "DEPLOY",
      status: "RECORDED", // moves to EXECUTED/FAILED only via markExecuted() (called by DeploymentExecutor)
      environment: input.environment,
      ref: input.ref,
      project: input.project ?? null,
      requestedBy: input.requestedBy,
      taskId: input.taskId ?? null,
      note: input.note ?? "",
      createdAt: new Date().toISOString(),
    };

    this._store.save(intent);
    this._auditLog.record(input.requestedBy, "DEPLOYMENT_INTENT_RECORDED", {
      environment: intent.environment,
      ref: intent.ref,
      ...(intent.taskId ? { taskId: intent.taskId } : {}),
    });
    this._emit(EVENTS.DEPLOYMENT_INTENT_RECORDED, intent);

    return intent;
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{environment?: string, taskId?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  /**
   * Record the outcome of a real deployment for an intent. This is
   * the ONLY way an intent's status moves away from "RECORDED" —
   * DeploymentCenter itself never calls this; only DeploymentExecutor
   * does, after actually talking to the deployment provider's API.
   * @param {string} id
   * @param {{status: "EXECUTED"|"FAILED", result?: *, error?: string, executedBy?: string}} outcome
   * @returns {import('../../shared/types.js').DeploymentIntent}
   */
  markExecuted(id, outcome) {
    const intent = this._store.getById(id);
    if (!intent) {
      throw new Error(`DeploymentCenter.markExecuted: intent not found: ${id}`);
    }
    if (intent.status !== "RECORDED") {
      throw new Error(
        `DeploymentCenter.markExecuted: intent ${id} is already ${intent.status}, cannot execute again`
      );
    }
    if (!outcome || (outcome.status !== "EXECUTED" && outcome.status !== "FAILED")) {
      throw new Error('DeploymentCenter.markExecuted requires outcome.status of "EXECUTED" or "FAILED"');
    }

    intent.status = outcome.status;
    intent.result = outcome.result ?? null;
    intent.error = outcome.error ?? null;
    intent.executedBy = outcome.executedBy ?? null;
    intent.executedAt = new Date().toISOString();

    this._store.save(intent);
    this._auditLog.record(
      outcome.executedBy ?? intent.requestedBy,
      outcome.status === "EXECUTED" ? "DEPLOYMENT_INTENT_EXECUTED" : "DEPLOYMENT_INTENT_EXECUTION_FAILED",
      {
        intentId: id,
        environment: intent.environment,
        ...(intent.taskId ? { taskId: intent.taskId } : {}),
      }
    );
    this._emit(
      outcome.status === "EXECUTED"
        ? EVENTS.DEPLOYMENT_INTENT_EXECUTED
        : EVENTS.DEPLOYMENT_INTENT_EXECUTION_FAILED,
      intent
    );

    return intent;
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
