/** Browser-local staff data. No authentication, network access, or HTML rendering. */

export const PROJECT_STAGES = Object.freeze(["Exploring", "Designing", "Building", "Testing", "Paused"]);
export const TASK_STATUSES = Object.freeze(["To do", "In progress", "Done"]);
export const FIELD_LIMITS = Object.freeze({ title: 120, description: 2000, body: 20000, id: 128 });
export const MAX_BACKUP_LENGTH = 10 * 1024 * 1024;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const kinds = Object.freeze({ project: "projects", projects: "projects", task: "tasks", tasks: "tasks", note: "notes", notes: "notes" });
const editableKeys = Object.freeze({
  projects: ["title", "description", "stage", "archived"],
  tasks: ["title", "projectId", "status", "dueDate"],
  notes: ["title", "body", "projectId"]
});
const defaults = Object.freeze({
  projects: { description: "", stage: "Exploring", archived: false },
  tasks: { projectId: "", status: "To do", dueDate: "" },
  notes: { body: "", projectId: "" }
});

function invalid(path, message) {
  throw new TypeError(`${path} ${message}`);
}

function objectShape(input, allowed, required, path) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid(path, "must be an object.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, "must be a plain data object.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key)) invalid(path, "contains an unsupported field.");
    if (!hasOwn(descriptors[key], "value")) invalid(`${path}.${key}`, "must be a data value, not an accessor.");
  }
  for (const key of required) {
    if (!hasOwn(descriptors, key)) invalid(`${path}.${key}`, "is required.");
  }
}

function text(value, path, limit, required = false) {
  if (typeof value !== "string") invalid(path, "must be a string.");
  if (value.length > limit) invalid(path, `must be ${limit} characters or fewer.`);
  if (required && !value.trim()) invalid(path, "must not be empty.");
  return required ? value.trim() : value;
}

function identifier(value, path, allowEmpty = false) {
  text(value, path, FIELD_LIMITS.id);
  if (allowEmpty && value === "") return value;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) invalid(path, "must be a nonempty identifier using letters, numbers, hyphens or underscores.");
  return value;
}

function timestamp(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid(path, "must be an ISO UTC timestamp.");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(path, "must be a real date and time.");
  return value;
}

function dueDate(value, path) {
  if (value === "") return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) invalid(path, "must be YYYY-MM-DD or empty.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(path, "must be a real calendar date.");
  return value;
}

function field(value, key, path) {
  switch (key) {
    case "title": return text(value, path, FIELD_LIMITS.title, true);
    case "description": return text(value, path, FIELD_LIMITS.description);
    case "body": return text(value, path, FIELD_LIMITS.body);
    case "projectId": return identifier(value, path, true);
    case "stage":
      if (!PROJECT_STAGES.includes(value)) invalid(path, "is not a supported project stage.");
      return value;
    case "status":
      if (!TASK_STATUSES.includes(value)) invalid(path, "is not a supported task status.");
      return value;
    case "dueDate": return dueDate(value, path);
    case "archived":
      if (typeof value !== "boolean") invalid(path, "must be a boolean.");
      return value;
    default: invalid(path, "is not an editable field.");
  }
}

function collectionKind(kind) {
  if (typeof kind !== "string" || !hasOwn(kinds, kind)) invalid("Record kind", "must be project, task or note.");
  return kinds[kind];
}

function editableFields(kind, input, creating = false) {
  const required = creating ? ["title"] : [];
  objectShape(input, editableKeys[kind], required, "Fields");
  const result = {};
  for (const key of editableKeys[kind]) {
    if (hasOwn(input, key)) result[key] = field(input[key], key, `Fields.${key}`);
  }
  return result;
}

function record(input, kind, index) {
  const path = `${kind}[${index}]`;
  const keys = ["id", ...editableKeys[kind], "createdAt", "updatedAt"];
  objectShape(input, keys, keys, path);
  const result = { id: identifier(input.id, `${path}.id`) };
  for (const key of editableKeys[kind]) result[key] = field(input[key], key, `${path}.${key}`);
  result.createdAt = timestamp(input.createdAt, `${path}.createdAt`);
  result.updatedAt = timestamp(input.updatedAt, `${path}.updatedAt`);
  if (result.updatedAt < result.createdAt) invalid(`${path}.updatedAt`, "must not precede createdAt.");
  return result;
}

function collection(input, kind) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid(kind, "must be an array.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length) invalid(kind, "contains an unsupported array property.");
    if (!hasOwn(descriptors[key], "value")) invalid(kind, "must not contain accessors.");
  }
  const result = [];
  for (let index = 0; index < input.length; index += 1) {
    if (!hasOwn(descriptors, String(index))) invalid(kind, "must not contain empty array slots.");
    result.push(record(descriptors[index].value, kind, index));
  }
  return result;
}

export function createEmptyWorkspace() {
  return { version: 1, projects: [], tasks: [], notes: [] };
}

/** Strictly validate and copy all data; unknown properties are never merged. */
export function validateWorkspace(input) {
  const keys = ["version", "projects", "tasks", "notes"];
  objectShape(input, keys, keys, "Workspace");
  if (input.version !== 1) invalid("Workspace.version", "must be 1.");
  const result = {
    version: 1,
    projects: collection(input.projects, "projects"),
    tasks: collection(input.tasks, "tasks"),
    notes: collection(input.notes, "notes")
  };
  const ids = new Set();
  for (const records of [result.projects, result.tasks, result.notes]) {
    for (const item of records) {
      if (ids.has(item.id)) invalid("Workspace", `contains duplicate id ${item.id}.`);
      ids.add(item.id);
    }
  }
  const projectIds = new Set(result.projects.map((project) => project.id));
  for (const item of [...result.tasks, ...result.notes]) {
    if (item.projectId !== "" && !projectIds.has(item.projectId)) invalid("Workspace", `contains an invalid project link for ${item.id}.`);
  }
  return result;
}

function freshId(workspace) {
  const crypto = globalThis.crypto;
  if (!crypto || (typeof crypto.randomUUID !== "function" && typeof crypto.getRandomValues !== "function")) throw new Error("This browser cannot generate workspace identifiers.");
  const ids = new Set([...workspace.projects, ...workspace.tasks, ...workspace.notes].map((item) => item.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let id;
    if (typeof crypto.randomUUID === "function") id = crypto.randomUUID();
    else {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    if (!ids.has(id)) return id;
  }
  throw new Error("Could not generate a unique workspace identifier. Please try again.");
}

function nextTimestamp(previous = "") {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) : 0)).toISOString();
}

export function createRecord(workspace, kind, fields) {
  const data = validateWorkspace(workspace);
  const key = collectionKind(kind);
  const values = editableFields(key, fields, true);
  const now = nextTimestamp();
  data[key].push({ id: freshId(data), ...defaults[key], ...values, createdAt: now, updatedAt: now });
  return validateWorkspace(data);
}

export function updateRecord(workspace, kind, id, fields) {
  const data = validateWorkspace(workspace);
  const key = collectionKind(kind);
  identifier(id, "Record id");
  const values = editableFields(key, fields);
  const index = data[key].findIndex((item) => item.id === id);
  if (index === -1) invalid("Record", "does not exist.");
  if (Object.keys(values).length) data[key][index] = { ...data[key][index], ...values, updatedAt: nextTimestamp(data[key][index].updatedAt) };
  return validateWorkspace(data);
}

export function deleteRecord(workspace, kind, id) {
  const data = validateWorkspace(workspace);
  const key = collectionKind(kind);
  identifier(id, "Record id");
  if (!data[key].some((item) => item.id === id)) invalid("Record", "does not exist.");
  data[key] = data[key].filter((item) => item.id !== id);
  if (key === "projects") {
    for (const linkedKind of ["tasks", "notes"]) {
      data[linkedKind] = data[linkedKind].map((item) => item.projectId === id
        ? { ...item, projectId: "", updatedAt: nextTimestamp(item.updatedAt) }
        : item);
    }
  }
  return validateWorkspace(data);
}

export function exportWorkspace(workspace) {
  const serialized = JSON.stringify(validateWorkspace(workspace), null, 2);
  checkBackupSize(serialized);
  return serialized;
}

function checkBackupSize(serialized) {
  if (serialized.length > MAX_BACKUP_LENGTH) invalid("Backup", "is too large (maximum 10 MiB of text).");
}

export function parseBackup(input) {
  if (typeof input !== "string") invalid("Backup", "must be JSON text.");
  checkBackupSize(input);
  let parsed;
  try {
    parsed = JSON.parse(input.replace(/^\uFEFF/, ""));
  } catch {
    invalid("Backup", "must contain valid JSON.");
  }
  return validateWorkspace(parsed);
}
