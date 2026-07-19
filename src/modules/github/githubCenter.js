import { randomUUID } from "node:crypto";
import { EVENTS } from "../../shared/types.js";

/** Recognized intent types. Kept small and typed, not open strings. */
const INTENT_TYPES = Object.freeze({
  CREATE_BRANCH: "CREATE_BRANCH",
  COMMIT: "COMMIT",
  OPEN_PULL_REQUEST: "OPEN_PULL_REQUEST",
});

/**
 * GitHubCenter — BOUNDARY module, real internally, real GitHub calls
 * only through a separate, approval-gated executor.
 *
 * Exposes a small, typed interface for the repo/branch/commit-oriented
 * operations the workflow spine needs. Every `request*()` method here
 * only *records intent* — it builds a GithubIntent record, audits it,
 * and emits an event. GitHubCenter itself still has no HTTP client, no
 * credentials, no network call.
 *
 * A real GitHub call only happens if a separate `GithubExecutor` (see
 * githubExecutor.js) is invoked with a RECORDED intent's id AND proof
 * of an APPROVED approval request. `markExecuted()` is how the
 * executor reports back — it's the only way an intent's status can
 * change away from RECORDED.
 *
 * This is separate from whatever GitHub tooling may still live in
 * /admin (CEO Chat Foundation v1) — this module does not touch or
 * replace that.
 */
export class GitHubCenter {
  /**
   * @param {{store: import('./store.js').InMemoryGithubIntentStore, auditLog: import('../logs/auditLog.js').AuditLog, eventBus?: import('../../shared/eventBus.js').EventBus}} deps
   */
  constructor({ store, auditLog, eventBus = null }) {
    this._store = store;
    this._auditLog = auditLog;
    this._eventBus = eventBus;
  }

  /**
   * Record intent to create a branch. Does not create anything.
   * @param {{repo: string, branch: string, baseBranch: string, requestedBy: string, taskId?: string, note?: string}} input
   * @returns {import('../../shared/types.js').GithubIntent}
   */
  requestBranchCreation(input) {
    if (!input || !input.repo || !input.branch || !input.baseBranch || !input.requestedBy) {
      throw new Error(
        "GitHubCenter.requestBranchCreation requires: repo, branch, baseBranch, requestedBy"
      );
    }
    return this._recordIntent(
      INTENT_TYPES.CREATE_BRANCH,
      "GITHUB_BRANCH_INTENT_RECORDED",
      EVENTS.GITHUB_BRANCH_INTENT_RECORDED,
      {
        repo: input.repo,
        branch: input.branch,
        baseBranch: input.baseBranch,
        requestedBy: input.requestedBy,
        taskId: input.taskId ?? null,
        note: input.note ?? "",
      }
    );
  }

  /**
   * Record intent to make a commit. Does not commit anything.
   * `files` (path + content) is optional here at recording time, but
   * required for GithubExecutor to actually perform the commit later —
   * without real file content there's nothing to push.
   * @param {{repo: string, branch: string, message: string, requestedBy: string, taskId?: string, filesChanged?: string[], files?: {path: string, content: string}[]}} input
   * @returns {import('../../shared/types.js').GithubIntent}
   */
  requestCommit(input) {
    if (!input || !input.repo || !input.branch || !input.message || !input.requestedBy) {
      throw new Error(
        "GitHubCenter.requestCommit requires: repo, branch, message, requestedBy"
      );
    }
    return this._recordIntent(
      INTENT_TYPES.COMMIT,
      "GITHUB_COMMIT_INTENT_RECORDED",
      EVENTS.GITHUB_COMMIT_INTENT_RECORDED,
      {
        repo: input.repo,
        branch: input.branch,
        message: input.message,
        requestedBy: input.requestedBy,
        taskId: input.taskId ?? null,
        filesChanged: input.filesChanged ?? [],
        files: input.files ?? [],
      }
    );
  }

  /**
   * Record intent to open a pull request. Does not open anything.
   * @param {{repo: string, sourceBranch: string, targetBranch: string, title: string, requestedBy: string, taskId?: string}} input
   * @returns {import('../../shared/types.js').GithubIntent}
   */
  requestPullRequest(input) {
    if (
      !input ||
      !input.repo ||
      !input.sourceBranch ||
      !input.targetBranch ||
      !input.title ||
      !input.requestedBy
    ) {
      throw new Error(
        "GitHubCenter.requestPullRequest requires: repo, sourceBranch, targetBranch, title, requestedBy"
      );
    }
    return this._recordIntent(
      INTENT_TYPES.OPEN_PULL_REQUEST,
      "GITHUB_PR_INTENT_RECORDED",
      EVENTS.GITHUB_PR_INTENT_RECORDED,
      {
        repo: input.repo,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        title: input.title,
        requestedBy: input.requestedBy,
        taskId: input.taskId ?? null,
      }
    );
  }

  /** @param {string} id */
  getById(id) {
    return this._store.getById(id);
  }

  /** @param {{type?: string, repo?: string, taskId?: string}} [filter] */
  list(filter) {
    return this._store.list(filter);
  }

  /**
   * Record the outcome of a real GitHub API call for an intent. This
   * is the ONLY way an intent's status moves away from "RECORDED" —
   * GitHubCenter itself never calls this; only GithubExecutor does,
   * after actually talking to the GitHub API.
   * @param {string} id
   * @param {{status: "EXECUTED"|"FAILED", result?: *, error?: string, executedBy?: string}} outcome
   * @returns {import('../../shared/types.js').GithubIntent}
   */
  markExecuted(id, outcome) {
    const intent = this._store.getById(id);
    if (!intent) {
      throw new Error(`GitHubCenter.markExecuted: intent not found: ${id}`);
    }
    if (intent.status !== "RECORDED") {
      throw new Error(
        `GitHubCenter.markExecuted: intent ${id} is already ${intent.status}, cannot execute again`
      );
    }
    if (!outcome || (outcome.status !== "EXECUTED" && outcome.status !== "FAILED")) {
      throw new Error('GitHubCenter.markExecuted requires outcome.status of "EXECUTED" or "FAILED"');
    }

    intent.status = outcome.status;
    intent.result = outcome.result ?? null;
    intent.error = outcome.error ?? null;
    intent.executedBy = outcome.executedBy ?? null;
    intent.executedAt = new Date().toISOString();

    this._store.save(intent);
    this._auditLog.record(
      outcome.executedBy ?? intent.requestedBy,
      outcome.status === "EXECUTED" ? "GITHUB_INTENT_EXECUTED" : "GITHUB_INTENT_EXECUTION_FAILED",
      {
        intentId: id,
        repo: intent.repo,
        ...(intent.taskId ? { taskId: intent.taskId } : {}),
      }
    );
    this._emit(
      outcome.status === "EXECUTED" ? EVENTS.GITHUB_INTENT_EXECUTED : EVENTS.GITHUB_INTENT_EXECUTION_FAILED,
      intent
    );

    return intent;
  }

  /**
   * @param {string} type - one of INTENT_TYPES
   * @param {string} auditAction
   * @param {string} eventName
   * @param {Object} fields
   */
  _recordIntent(type, auditAction, eventName, fields) {
    /** @type {import('../../shared/types.js').GithubIntent} */
    const intent = {
      id: randomUUID(),
      type,
      status: "RECORDED", // moves to EXECUTED/FAILED only via markExecuted() (called by GithubExecutor)
      createdAt: new Date().toISOString(),
      ...fields,
    };

    this._store.save(intent);
    this._auditLog.record(fields.requestedBy, auditAction, {
      repo: intent.repo,
      ...(intent.branch ? { branch: intent.branch } : {}),
      ...(intent.taskId ? { taskId: intent.taskId } : {}),
    });
    this._emit(eventName, intent);

    return intent;
  }

  _emit(eventName, payload) {
    if (this._eventBus) {
      this._eventBus.emit(eventName, payload);
    }
  }
}
