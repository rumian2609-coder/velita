import { createEmptyWorkspace, exportWorkspace, parseBackup, validateWorkspace } from "./workspace-core.mjs";

export const WORKSPACE_STORAGE_PREFIX = "velita:staff:workspace:v1:";

/** A local-only store. A single setItem preserves existing data if storage fails. */
export function createWorkspaceStore(uid, storage = globalThis.localStorage) {
  if (typeof uid !== "string" || !uid.trim()) throw new TypeError("A signed-in user ID is required for workspace storage.");
  if (!storage || ["getItem", "setItem", "removeItem"].some((method) => typeof storage[method] !== "function")) {
    throw new TypeError("Local workspace storage is unavailable.");
  }
  const key = `${WORKSPACE_STORAGE_PREFIX}${encodeURIComponent(uid)}`;
  return Object.freeze({
    key,
    load() {
      const saved = storage.getItem(key);
      if (saved === null) return createEmptyWorkspace();
      // Corrupt data throws and stays in storage until the user chooses to act.
      return parseBackup(saved);
    },
    save(workspace) {
      const data = validateWorkspace(workspace);
      // Check the actual, larger backup representation before any storage write.
      // Compact storage must never accept data that cannot be exported/imported.
      exportWorkspace(data);
      storage.setItem(key, JSON.stringify(data));
      return data;
    },
    clear() {
      storage.removeItem(key);
    }
  });
}
