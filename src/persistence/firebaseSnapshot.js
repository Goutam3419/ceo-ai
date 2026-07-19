/**
 * FirebaseSnapshot — real persistence, without an async rewrite of the
 * rest of the codebase.
 *
 * Every store in this project (InMemoryTaskStore, InMemoryApprovalStore,
 * etc.) exposes synchronous save()/getById()/list() — every Center
 * class in every module was built on that assumption. Rewriting all of
 * them to be async so each individual save() could hit Firestore
 * directly would be a large, risky refactor across the entire
 * codebase — exactly the kind of change this project has deliberately
 * avoided at every milestone.
 *
 * Instead: this class takes a snapshot of ALL stores' current state
 * (via their existing synchronous list()) and writes it as ONE
 * Firestore document. On load, it reads that document and rehydrates
 * every store by calling their existing synchronous save() for each
 * record. The rest of the codebase never knows Firestore exists.
 *
 * `db` is injected (same pattern as GithubExecutor's fetchImpl /
 * DeploymentExecutor's fetchImpl) so this class is fully unit-testable
 * with a fake Firestore-shaped object — no real Firebase project
 * needed to verify the export/import logic.
 */
export class FirebaseSnapshot {
  /**
   * @param {{db: {doc: (path: string) => {get: () => Promise<{exists: boolean, data: () => any}>, set: (data: any) => Promise<void>}}, docPath?: string}} deps
   */
  constructor({ db, docPath = "ai-company-os/state" }) {
    if (!db || typeof db.doc !== "function") {
      throw new Error("FirebaseSnapshot requires a Firestore-shaped db with a doc() method");
    }
    this._db = db;
    this._docPath = docPath;
  }

  /**
   * Export every store's current records into one document.
   * @param {Object<string, {list: () => any[]}>} stores - name -> store instance
   */
  async save(stores) {
    const state = {};
    for (const [name, store] of Object.entries(stores)) {
      if (store && typeof store.list === "function") {
        state[name] = store.list();
      }
    }
    await this._db.doc(this._docPath).set({
      state,
      savedAt: new Date().toISOString(),
    });
    return state;
  }

  /**
   * Rehydrate every store from the last saved document, if one exists.
   * Returns false (and does nothing) if no snapshot has ever been saved.
   * @param {Object<string, {save: (record: any) => any}>} stores - name -> store instance
   * @returns {Promise<boolean>}
   */
  async load(stores) {
    const snapshot = await this._db.doc(this._docPath).get();
    if (!snapshot.exists) {
      return false;
    }
    const data = snapshot.data();
    const state = data?.state ?? {};
    for (const [name, records] of Object.entries(state)) {
      const store = stores[name];
      if (store && typeof store.save === "function" && Array.isArray(records)) {
        for (const record of records) {
          store.save(record);
        }
      }
    }
    return true;
  }
}
