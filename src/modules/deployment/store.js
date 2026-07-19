/**
 * In-memory persistence for deployment intents.
 *
 * Same swappable-store pattern as every other module's store: isolated
 * behind save/getById/list so a real store (or eventually a real
 * deployment-provider executor) can replace it later without touching
 * deploymentCenter.js.
 */
export class InMemoryDeploymentIntentStore {
  constructor() {
    /** @type {Map<string, import('../../shared/types.js').DeploymentIntent>} */
    this._records = new Map();
  }

  /** @param {import('../../shared/types.js').DeploymentIntent} intent */
  save(intent) {
    this._records.set(intent.id, intent);
    return intent;
  }

  /** @param {string} id */
  getById(id) {
    return this._records.get(id) ?? null;
  }

  /** @param {{environment?: string, taskId?: string}} [filter] */
  list(filter = {}) {
    let all = [...this._records.values()];
    if (filter.environment) all = all.filter((i) => i.environment === filter.environment);
    if (filter.taskId) all = all.filter((i) => i.taskId === filter.taskId);
    return all;
  }
}
