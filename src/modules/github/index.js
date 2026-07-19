import { GitHubCenter } from "./githubCenter.js";
import { InMemoryGithubIntentStore } from "./store.js";
import { GithubExecutor } from "./githubExecutor.js";

export { GitHubCenter } from "./githubCenter.js";
export { InMemoryGithubIntentStore } from "./store.js";
export { GithubExecutor } from "./githubExecutor.js";

/**
 * Convenience factory for wiring a GitHubCenter with default in-memory
 * store, given shared deps (auditLog/eventBus) the app shell owns.
 *
 * @param {{auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
 */
export function createGithubCenter(deps) {
  return new GitHubCenter({
    store: new InMemoryGithubIntentStore(),
    auditLog: deps.auditLog,
    eventBus: deps.eventBus ?? null,
  });
}

/**
 * Convenience factory for wiring a GithubExecutor. Reads the token
 * from process.env.GITHUB_TOKEN by default — NEVER hardcode a token
 * here. Throws clearly if the env var is missing, rather than
 * silently constructing a broken executor.
 *
 * @param {{githubCenter: GitHubCenter, approvalCenter: import('../approval-center/approvalCenter.js').ApprovalCenter, token?: string, fetchImpl?: typeof fetch}} deps
 */
export function createGithubExecutor(deps) {
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "createGithubExecutor: no GitHub token found. Set the GITHUB_TOKEN environment variable (e.g. in Vercel's Environment Variables settings) or pass { token } explicitly."
    );
  }
  return new GithubExecutor({
    githubCenter: deps.githubCenter,
    approvalCenter: deps.approvalCenter,
    token,
    fetchImpl: deps.fetchImpl,
  });
}

export const boundary = Object.freeze({
  module: "github",
  status: "REAL",
  implemented: [
    "requestBranchCreation()",
    "requestCommit() — now optionally carries real file content via `files`",
    "requestPullRequest()",
    "getById()",
    "list() — filter by type/repo/taskId",
    "markExecuted() — records a real execution outcome (EXECUTED/FAILED)",
    "GithubExecutor.execute() — makes a REAL GitHub API call, gated by an APPROVED approval request",
  ],
  notImplemented: [
    "source-of-truth sync",
    "webhook handling / GitHub events coming back in",
    "retry/backoff on transient API failures",
  ],
  note: "GitHubCenter itself still never makes a network call. GithubExecutor is the only piece that does, and only when constructed with a real token (from GITHUB_TOKEN) and invoked with proof of an APPROVED approval request. Separate from any GitHub tooling still in /admin (CEO Chat Foundation v1).",
});
