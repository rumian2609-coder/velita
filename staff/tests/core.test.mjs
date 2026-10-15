import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyWorkspace, validateWorkspace, createRecord, updateRecord,
  deleteRecord, exportWorkspace, parseBackup, FIELD_LIMITS, MAX_BACKUP_LENGTH
} from "../assets/workspace-core.mjs";
import { createWorkspaceStore } from "../assets/workspace-store.mjs";

const time = "2026-10-15T10:00:00.000Z";
function fixture() {
  return {
    version: 1,
    projects: [{ id: "project-1", title: "First idea", description: "Investigate carefully.", stage: "Exploring", archived: false, createdAt: time, updatedAt: time }],
    tasks: [{ id: "task-1", title: "Sketch", projectId: "project-1", status: "To do", dueDate: "2028-02-29", createdAt: time, updatedAt: time }],
    notes: [{ id: "note-1", title: "A thought", body: "Keep the original.\nExplore another direction.", projectId: "project-1", createdAt: time, updatedAt: time }]
  };
}

function memoryStorage() {
  const data = new Map();
  const calls = [];
  return {
    data, calls,
    getItem(key) { calls.push(["get", key]); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { calls.push(["set", key]); data.set(key, value); },
    removeItem(key) { calls.push(["remove", key]); data.delete(key); }
  };
}

function workspaceWithExportLength(length) {
  const data = createEmptyWorkspace();
  data.notes = Array.from({ length: Math.ceil(length / FIELD_LIMITS.body) }, (_, index) => ({
    id: `boundary-note-${index}`, title: `Note ${index}`, body: "", projectId: "", createdAt: time, updatedAt: time
  }));
  let remaining = length - JSON.stringify(data, null, 2).length;
  assert.ok(remaining >= 0);
  for (const note of data.notes) {
    const fill = Math.min(remaining, FIELD_LIMITS.body);
    note.body = "x".repeat(fill);
    remaining -= fill;
  }
  assert.equal(remaining, 0);
  assert.equal(JSON.stringify(data, null, 2).length, length);
  return data;
}

test("empty workspaces and validation return independent copies", () => {
  const first = createEmptyWorkspace();
  const second = createEmptyWorkspace();
  assert.deepEqual(first, { version: 1, projects: [], tasks: [], notes: [] });
  assert.notEqual(first.projects, second.projects);
  const source = fixture();
  const validated = validateWorkspace(source);
  validated.projects[0].title = "Changed copy";
  assert.equal(source.projects[0].title, "First idea");
});

test("create defaults and all three record kinds leave the source untouched", () => {
  const original = createEmptyWorkspace();
  let data = createRecord(original, "project", { title: "  A better idea  " });
  const project = data.projects[0];
  assert.equal(project.title, "A better idea");
  assert.equal(project.stage, "Exploring");
  assert.equal(project.archived, false);
  assert.equal(project.description, "");
  assert.equal(project.createdAt, project.updatedAt);
  data = createRecord(data, "tasks", { title: "Build a prototype", projectId: project.id });
  data = createRecord(data, "note", { title: "Question", body: "What would make this useful?", projectId: project.id });
  assert.equal(data.tasks[0].status, "To do");
  assert.equal(data.tasks[0].dueDate, "");
  assert.equal(new Set([project.id, data.tasks[0].id, data.notes[0].id]).size, 3);
  assert.deepEqual(original, createEmptyWorkspace());
});

test("updates validate fields and preserve identity and creation time", () => {
  const source = fixture();
  const updated = updateRecord(source, "projects", "project-1", { stage: "Building", archived: true });
  assert.equal(updated.projects[0].stage, "Building");
  assert.equal(updated.projects[0].archived, true);
  assert.equal(updated.projects[0].id, "project-1");
  assert.equal(updated.projects[0].createdAt, time);
  assert.ok(updated.projects[0].updatedAt >= time);
  assert.equal(updated.tasks[0].projectId, "project-1");
  assert.equal(source.projects[0].archived, false);
  assert.throws(() => updateRecord(source, "task", "missing", { status: "Done" }), /does not exist/);
  assert.throws(() => updateRecord(source, "project", "project-1", { id: "replacement" }), /unsupported field/);
  assert.throws(() => createRecord(source, "project", { title: "New", createdAt: time }), /unsupported field/);
});

test("deleting a project unlinks and retains associated tasks and notes", () => {
  const source = fixture();
  const result = deleteRecord(source, "project", "project-1");
  assert.equal(result.projects.length, 0);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.notes.length, 1);
  assert.equal(result.tasks[0].projectId, "");
  assert.equal(result.notes[0].projectId, "");
  assert.equal(result.notes[0].body, source.notes[0].body);
  assert.equal(source.tasks[0].projectId, "project-1");
  const withoutTask = deleteRecord(result, "task", "task-1");
  assert.equal(withoutTask.tasks.length, 0);
  assert.equal(withoutTask.notes.length, 1);
  assert.equal(deleteRecord(withoutTask, "notes", "note-1").notes.length, 0);
  assert.throws(() => deleteRecord(result, "projects", "project-1"), /does not exist/);
});

test("field validation rejects wrong types, unsupported enums and oversized content", () => {
  const source = fixture();
  for (const fields of [{ title: " " }, { title: 123 }, { title: "x".repeat(FIELD_LIMITS.title + 1) }, { stage: "Released" }, { archived: "false" }, { description: null }]) {
    assert.throws(() => updateRecord(source, "project", "project-1", fields), TypeError);
  }
  assert.throws(() => updateRecord(source, "note", "note-1", { body: "x".repeat(FIELD_LIMITS.body + 1) }), /20000/);
  assert.throws(() => updateRecord(source, "task", "task-1", { status: "Complete" }), /supported task status/);
  assert.throws(() => createRecord(source, "constructor", { title: "Invalid" }), /Record kind/);
  assert.throws(() => createRecord(source, "project", {}), /title.*required/);
});

test("calendar dates and timestamps reject rollover and backward updates", () => {
  const source = fixture();
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01", null, 123]) {
    assert.throws(() => updateRecord(source, "task", "task-1", { dueDate: date }), TypeError);
  }
  assert.equal(updateRecord(source, "task", "task-1", { dueDate: "" }).tasks[0].dueDate, "");
  for (const value of ["2026-02-30T10:00:00.000Z", "2026-10-15", "2026-10-15T10:00:00Z", null]) {
    const bad = fixture(); bad.projects[0].createdAt = value;
    assert.throws(() => validateWorkspace(bad), TypeError);
  }
  const bad = fixture(); bad.tasks[0].updatedAt = "2025-10-15T10:00:00.000Z";
  assert.throws(() => validateWorkspace(bad), /must not precede/);
});

test("backups round-trip all data and reject malformed schemas and broken links", () => {
  const source = fixture();
  assert.deepEqual(parseBackup(exportWorkspace(source)), source);
  assert.deepEqual(parseBackup(`\uFEFF${exportWorkspace(source)}`), source);
  for (const value of ["", "not json", "null", "[]", "{}", '{"version":2,"projects":[],"tasks":[],"notes":[]}']) {
    assert.throws(() => parseBackup(value), TypeError);
  }
  const duplicate = fixture(); duplicate.notes[0].id = "task-1";
  assert.throws(() => validateWorkspace(duplicate), /duplicate id/);
  const broken = fixture(); broken.notes[0].projectId = "missing-project";
  assert.throws(() => validateWorkspace(broken), /invalid project link/);
  assert.throws(() => createRecord(source, "tasks", { title: "No project", projectId: "missing-project" }), /invalid project link/);
  const extra = fixture(); extra.projects[0].unexpected = true;
  assert.throws(() => validateWorkspace(extra), /unsupported field/);
  const missing = fixture(); delete missing.tasks[0].dueDate;
  assert.throws(() => validateWorkspace(missing), /dueDate.*required/);
  assert.throws(() => parseBackup(" ".repeat(MAX_BACKUP_LENGTH + 1)), /too large/);
});

test("untrusted schema cannot inject prototypes, accessors, symbols or sparse arrays", () => {
  const polluted = '{"version":1,"projects":[],"tasks":[],"notes":[],"__proto__":{"polluted":true}}';
  assert.throws(() => parseBackup(polluted), /unsupported field/);
  assert.equal({}.polluted, undefined);
  const inherited = Object.create({ version: 1 });
  Object.assign(inherited, { projects: [], tasks: [], notes: [] });
  assert.throws(() => validateWorkspace(inherited), /plain data object/);
  const accessor = fixture();
  Object.defineProperty(accessor.projects[0], "title", { get() { throw new Error("Getter ran"); }, enumerable: true });
  assert.throws(() => validateWorkspace(accessor), /not an accessor/);
  const symbolic = fixture(); symbolic[Symbol("secret")] = 1;
  assert.throws(() => validateWorkspace(symbolic), /unsupported field/);
  const sparse = fixture(); sparse.tasks = new Array(1);
  assert.throws(() => validateWorkspace(sparse), /empty array slots/);
  const arrayProperty = fixture(); arrayProperty.notes.extra = true;
  assert.throws(() => validateWorkspace(arrayProperty), /unsupported array property/);
});

test("storage is isolated by exact user ID, survives reloading, and clears only its own key", () => {
  const storage = memoryStorage();
  const one = createWorkspaceStore("founder/one", storage);
  const two = createWorkspaceStore("founder%2Fone", storage);
  assert.notEqual(one.key, two.key);
  assert.ok(one.key.startsWith("velita:staff:workspace:v1:"));
  assert.deepEqual(one.load(), createEmptyWorkspace());
  const saved = one.save(fixture());
  assert.deepEqual(one.load(), saved);
  assert.deepEqual(createWorkspaceStore("founder/one", storage).load(), fixture());
  assert.deepEqual(two.load(), createEmptyWorkspace());
  two.save(createEmptyWorkspace());
  one.clear();
  assert.equal(storage.data.has(one.key), false);
  assert.equal(storage.data.has(two.key), true);
  for (const uid of ["", "  ", null, 123]) assert.throws(() => createWorkspaceStore(uid, storage), /user ID/);
  assert.throws(() => createWorkspaceStore("founder", {}), /unavailable/);
});

test("corrupt local data and storage failures are surfaced without overwriting prior data", () => {
  const storage = memoryStorage();
  const store = createWorkspaceStore("founder", storage);
  storage.data.set(store.key, "broken JSON");
  assert.throws(() => store.load(), /valid JSON/);
  assert.equal(storage.data.get(store.key), "broken JSON");
  assert.equal(storage.calls.filter(([method]) => method !== "get").length, 0);
  storage.data.set(store.key, exportWorkspace(fixture()));
  const previous = storage.data.get(store.key);
  const quotaError = new Error("Quota exceeded");
  storage.setItem = () => { throw quotaError; };
  assert.throws(() => store.save(createEmptyWorkspace()), (error) => error === quotaError);
  assert.equal(storage.data.get(store.key), previous);
  assert.throws(() => store.save({ version: 2 }), TypeError);
  assert.equal(storage.data.get(store.key), previous);
  const readError = new Error("Read denied");
  storage.getItem = () => { throw readError; };
  assert.throws(() => store.load(), (error) => error === readError);
  const removeError = new Error("Remove denied");
  storage.removeItem = () => { throw removeError; };
  assert.throws(() => store.clear(), (error) => error === removeError);
});

test("the exact backup-size boundary saves, exports and imports successfully", () => {
  const boundary = workspaceWithExportLength(MAX_BACKUP_LENGTH);
  const exported = exportWorkspace(boundary);
  assert.equal(exported.length, MAX_BACKUP_LENGTH);
  assert.deepEqual(parseBackup(exported), boundary);
  const storage = memoryStorage();
  const store = createWorkspaceStore("boundary-account", storage);
  assert.deepEqual(store.save(boundary), boundary);
  assert.ok(storage.data.get(store.key).length < exported.length, "storage remains compact");
  assert.deepEqual(store.load(), boundary);
});

test("oversized pretty backups cannot export or save even when compact data fits", () => {
  const oversized = workspaceWithExportLength(MAX_BACKUP_LENGTH + 1);
  assert.ok(JSON.stringify(oversized).length < MAX_BACKUP_LENGTH);
  assert.throws(() => exportWorkspace(oversized), /too large/);
  const storage = memoryStorage();
  const store = createWorkspaceStore("existing-account", storage);
  store.save(fixture());
  const previous = storage.data.get(store.key);
  const writes = storage.calls.filter(([method]) => method === "set").length;
  assert.throws(() => store.save(oversized), /too large/);
  assert.equal(storage.data.get(store.key), previous);
  assert.equal(storage.calls.filter(([method]) => method === "set").length, writes, "size validation runs before any write");
  assert.deepEqual(store.load(), fixture());
});
