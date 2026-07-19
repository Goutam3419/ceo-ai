import { DeploymentCenter } from "./deploymentCenter.js";
import { InMemoryDeploymentIntentStore } from "./store.js";
import { DeploymentExecutor } from "./deploymentExecutor.js";

export { DeploymentCenter } from "./deploymentCenter.js";
export { InMemoryDeploymentIntentStore } from "./store.js";
export { DeploymentExecutor } from "./deploymentExecutor.js";

/**
 * Convenience factory for wiring a DeploymentCenter with default
 * in-memory store, given shared deps (auditLog/eventBus) the app
 * shell owns.
 *
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createDeploymentCenter(deps) {
  return new DeploymentCenter({
    store: new InMemoryDeploymentIntentStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

/**
 * Convenience factory for wiring a DeploymentExecutor. Reads the
 * token from process.env.VERCEL_TOKEN by default — NEVER hardcode a
 * token here. Throws clearly if the env var is missing.
 *
 * @param {{deploymentCenter: DeploymentCenter, approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, token?: string, fetchImpl?: typeof fetch}} deps
 */
export function createDeploymentExecutor(deps) {
  const token = deps.token ?? process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error(
      "createDeploymentExecutor: no Vercel token found. Set the VERCEL_TOKEN environment variable (in Vercel's own Environment Variables settings) or pass { token } explicitly."
    );
  }
  return new DeploymentExecutor({
    deploymentCenter: deps.deploymentCenter,
    approvalCenter: deps.approvalCenter,
    token,
    fetchImpl: deps.fetchImpl,
  });
}

export const boundary = Object.freeze({
  module: "deployment",
  status: "REAL",
  implemented: [
    "requestDeployment() — now optionally carries a `project` (Vercel project name/id)",
    "getById()",
    "list() — filter by environment/taskId",
    "markExecuted() — records a real execution outcome (EXECUTED/FAILED)",
    "DeploymentExecutor.execute() — triggers a REAL Vercel deployment, gated by an APPROVED approval request",
  ],
  notImplemented: [
    "rollback, environment promotion, multi-stage pipelines",
    "deployment status polling (Vercel deployments are async; this only triggers, doesn't wait for READY)",
  ],
  note: "DeploymentCenter itself still never makes a network call. DeploymentExecutor is the only piece that does, and only when constructed with a real token (from VERCEL_TOKEN) and invoked with proof of an APPROVED approval request.",
});
