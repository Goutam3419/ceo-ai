import { APPROVAL_STATUS } from "../../shared/types.js";

/**
 * GithubExecutor — the real network layer for GitHub Center.
 *
 * This is what turns a RECORDED GithubIntent into an actual GitHub API
 * call. It is deliberately a SEPARATE class from GitHubCenter (which
 * stays a pure intent-recorder) so that:
 *   - Every existing GitHubCenter test/consumer is completely
 *     unaffected — GitHubCenter's own code never calls the network.
 *   - Execution is impossible without both a real GitHub token AND
 *     proof of an APPROVED approval request — the founder-approval
 *     gate from the frozen plan is enforced here in code, not just by
 *     convention.
 *
 * The token is never hardcoded; it must be supplied by the caller,
 * which in a real deployment reads it from an environment variable
 * (e.g. `process.env.GITHUB_TOKEN`) — see index.js's
 * `createGithubExecutor()` factory.
 *
 * `fetchImpl` is injectable so this class can be fully unit-tested
 * without ever making a real network call — tests pass a fake
 * fetch-shaped function and assert on what URLs/bodies would have
 * been sent.
 */
export class GithubExecutor {
  /**
   * @param {{githubCenter: import('./githubCenter.js').GitHubCenter, approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, token: string, fetchImpl?: typeof fetch, apiBaseUrl?: string}} deps
   */
  constructor({ githubCenter, approvalCenter, token, fetchImpl, apiBaseUrl = "https://api.github.com" }) {
    if (!token) {
      throw new Error(
        "GithubExecutor requires a GitHub token. Never hardcode it — pass it from an environment variable."
      );
    }
    const resolvedFetch = fetchImpl ?? globalThis.fetch;
    if (typeof resolvedFetch !== "function") {
      throw new Error(
        "GithubExecutor requires a fetch implementation. None was provided and no global fetch was found."
      );
    }

    this._githubCenter = githubCenter;
    this._approvalCenter = approvalCenter;
    this._token = token;
    this._fetch = resolvedFetch;
    this._apiBaseUrl = apiBaseUrl;
  }

  /**
   * Execute a RECORDED intent for real. Requires the id of an
   * APPROVED approval request as proof — this is the founder-approval
   * gate, enforced here, not left to the caller's discretion.
   * @param {string} intentId
   * @param {{approvalRequestId: string, requestedBy?: string}} authorization
   * @returns {Promise<import('../../shared/types.js').GithubIntent>}
   */
  async execute(intentId, authorization) {
    const intent = this._githubCenter.getById(intentId);
    if (!intent) {
      throw new Error(`GithubExecutor.execute: intent not found: ${intentId}`);
    }
    if (intent.status !== "RECORDED") {
      throw new Error(
        `GithubExecutor.execute: intent ${intentId} is ${intent.status}, only RECORDED intents can be executed`
      );
    }
    if (!authorization || !authorization.approvalRequestId) {
      throw new Error(
        "GithubExecutor.execute requires authorization.approvalRequestId — GitHub actions must be approved before execution"
      );
    }

    const approval = this._approvalCenter.getById(authorization.approvalRequestId);
    if (!approval || approval.status !== APPROVAL_STATUS.APPROVED) {
      throw new Error(
        `GithubExecutor.execute: approval request ${authorization.approvalRequestId} is not APPROVED`
      );
    }

    try {
      let result;
      switch (intent.type) {
        case "CREATE_BRANCH":
          result = await this._createBranch(intent);
          break;
        case "COMMIT":
          result = await this._commitFiles(intent);
          break;
        case "OPEN_PULL_REQUEST":
          result = await this._openPullRequest(intent);
          break;
        default:
          throw new Error(`GithubExecutor.execute: unknown intent type: ${intent.type}`);
      }
      return this._githubCenter.markExecuted(intentId, {
        status: "EXECUTED",
        result,
        executedBy: authorization.requestedBy,
      });
    } catch (error) {
      this._githubCenter.markExecuted(intentId, {
        status: "FAILED",
        error: error.message,
        executedBy: authorization.requestedBy,
      });
      throw error;
    }
  }

  /**
   * @param {string} path - e.g. "/repos/owner/repo/git/refs"
   * @param {RequestInit} [options]
   */
  async _githubRequest(path, options = {}) {
    const response = await this._fetch(`${this._apiBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${body?.message ?? "unknown error"}`);
    }
    return body;
  }

  /** @param {import('../../shared/types.js').GithubIntent} intent */
  async _createBranch(intent) {
    const baseRef = await this._githubRequest(
      `/repos/${intent.repo}/git/ref/heads/${intent.baseBranch}`
    );
    const sha = baseRef?.object?.sha;
    if (!sha) {
      throw new Error(`GithubExecutor: could not resolve SHA for base branch ${intent.baseBranch}`);
    }
    return this._githubRequest(`/repos/${intent.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${intent.branch}`, sha }),
    });
  }

  /** @param {import('../../shared/types.js').GithubIntent} intent */
  async _commitFiles(intent) {
    if (!Array.isArray(intent.files) || intent.files.length === 0) {
      throw new Error(
        "GithubExecutor: commit intent has no file content to commit (intent.files is empty) — record the intent with real files to execute it"
      );
    }
    const results = [];
    for (const file of intent.files) {
      const result = await this._githubRequest(
        `/repos/${intent.repo}/contents/${file.path}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message: intent.message,
            content: Buffer.from(file.content, "utf-8").toString("base64"),
            branch: intent.branch,
          }),
        }
      );
      results.push(result);
    }
    return results;
  }

  /** @param {import('../../shared/types.js').GithubIntent} intent */
  async _openPullRequest(intent) {
    return this._githubRequest(`/repos/${intent.repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: intent.title,
        head: intent.sourceBranch,
        base: intent.targetBranch,
      }),
    });
  }
}
