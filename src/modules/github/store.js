/**
 * In-memory persistence for GitHub intents.
 *
 * Same swappable-store pattern as the other modules' stores: isolated
 * behind save/getById/list so a real store (or eventually a real
 * GitHub-backed executor) can replace it later without touching
 * githubCenter.js.
 */
export class InMemoryGithubIntentStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').GithubIntent>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').GithubIntent} intent */
  save(intent) {
    this._records.set(intent.id, intent);
    return intent;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{type?: string, repo?: string, taskId?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.type) all = all.filter((i) => i.type === filter.type);
    if (filter.repo) all = all.filter((i) => i.repo === filter.repo);
    if (filter.taskId) all = all.filter((i) => i.taskId === filter.taskId);
    return all;
  }
}
