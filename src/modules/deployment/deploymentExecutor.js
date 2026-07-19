import { APPROVAL_STATUS } from "../../shared/types.js";

/**
 * DeploymentExecutor — the real network layer for Deployment Center.
 *
 * Same shape and reasoning as GithubExecutor: a SEPARATE class from
 * DeploymentCenter (which stays a pure intent-recorder), so that:
 *   - Every existing DeploymentCenter test/consumer is completely
 *     unaffected — DeploymentCenter's own code never calls the
 *     network.
 *   - Execution is impossible without both a real Vercel token AND
 *     proof of an APPROVED approval request — the founder-approval
 *     gate is enforced here in code, not just by convention.
 *
 * The token is never hardcoded; it must be supplied by the caller,
 * which in a real deployment reads it from an environment variable
 * (e.g. `process.env.VERCEL_TOKEN`) — see index.js's
 * `createDeploymentExecutor()` factory.
 *
 * `fetchImpl` is injectable so this class can be fully unit-tested
 * without ever making a real network call.
 */
export class DeploymentExecutor {
  /**
   * @param {{deploymentCenter: import('./deploymentCenter.js').DeploymentCenter, approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, token: string, fetchImpl?: typeof fetch, apiBaseUrl?: string}} deps
   */
  constructor({ deploymentCenter, approvalCenter, token, fetchImpl, apiBaseUrl = "https://api.vercel.com" }) {
    if (!token) {
      throw new Error(
        "DeploymentExecutor requires a Vercel token. Never hardcode it — pass it from an environment variable."
      );
    }
    const resolvedFetch = fetchImpl ?? globalThis.fetch;
    if (typeof resolvedFetch !== "function") {
      throw new Error(
        "DeploymentExecutor requires a fetch implementation. None was provided and no global fetch was found."
      );
    }

    this._deploymentCenter = deploymentCenter;
    this._approvalCenter = approvalCenter;
    this._token = token;
    this._fetch = resolvedFetch;
    this._apiBaseUrl = apiBaseUrl;
  }

  /**
   * Execute a RECORDED deployment intent for real. Requires the id of
   * an APPROVED approval request as proof — the founder-approval gate,
   * enforced here, not left to the caller's discretion.
   * @param {string} intentId
   * @param {{approvalRequestId: string, requestedBy?: string}} authorization
   * @returns {Promise<import('../../shared/types.js').DeploymentIntent>}
   */
  async execute(intentId, authorization) {
    const intent = this._deploymentCenter.getById(intentId);
    if (!intent) {
      throw new Error(`DeploymentExecutor.execute: intent not found: ${intentId}`);
    }
    if (intent.status !== "RECORDED") {
      throw new Error(
        `DeploymentExecutor.execute: intent ${intentId} is ${intent.status}, only RECORDED intents can be executed`
      );
    }
    if (!authorization || !authorization.approvalRequestId) {
      throw new Error(
        "DeploymentExecutor.execute requires authorization.approvalRequestId — deployments must be approved before execution"
      );
    }

    const approval = this._approvalCenter.getById(authorization.approvalRequestId);
    if (!approval || approval.status !== APPROVAL_STATUS.APPROVED) {
      throw new Error(
        `DeploymentExecutor.execute: approval request ${authorization.approvalRequestId} is not APPROVED`
      );
    }

    if (!intent.project) {
      const err = new Error(
        "DeploymentExecutor: intent has no Vercel project set — record the intent with a project name/id to execute it"
      );
      this._deploymentCenter.markExecuted(intentId, {
        status: "FAILED",
        error: err.message,
        executedBy: authorization.requestedBy,
      });
      throw err;
    }

    try {
      const result = await this._triggerDeployment(intent);
      return this._deploymentCenter.markExecuted(intentId, {
        status: "EXECUTED",
        result,
        executedBy: authorization.requestedBy,
      });
    } catch (error) {
      this._deploymentCenter.markExecuted(intentId, {
        status: "FAILED",
        error: error.message,
        executedBy: authorization.requestedBy,
      });
      throw error;
    }
  }

  /** @param {import('../../shared/types.js').DeploymentIntent} intent */
  async _triggerDeployment(intent) {
    return this._vercelRequest("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: intent.project,
        project: intent.project,
        target: intent.environment === "production" ? "production" : "preview",
        gitSource: { type: "github", ref: intent.ref },
      }),
    });
  }

  /**
   * @param {string} path - e.g. "/v13/deployments"
   * @param {RequestInit} [options]
   */
  async _vercelRequest(path, options = {}) {
    const response = await this._fetch(`${this._apiBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this._token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.error?.message ?? body?.message ?? "unknown error";
      throw new Error(`Vercel API error ${response.status}: ${message}`);
    }
    return body;
  }
}
