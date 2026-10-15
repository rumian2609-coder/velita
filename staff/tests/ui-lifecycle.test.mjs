import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as core from "../assets/workspace-core.mjs";
import { createWorkspaceStore } from "../assets/workspace-store.mjs";

const moduleUrl = new URL("../assets/workspace.mjs", import.meta.url);
const originalSource = readFileSync(moduleUrl, "utf8");

function fakeElement() {
  const listeners = new Map();
  return {
    listeners,
    attributes: new Map(),
    classList: { toggle() {} },
    hidden: false,
    open: false,
    innerHTML: "",
    textContent: "",
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(type, listener, options = {}) {
      listeners.set(type, listener);
      options.signal?.addEventListener("abort", () => listeners.delete(type), { once: true });
    },
    querySelector() { return null; },
    remove() {},
    focus() {}
  };
}

function lifecycleHarness() {
  const values = new Map();
  let storageWrites = 0;
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem(key, value) { storageWrites += 1; values.set(key, value); },
    removeItem: (key) => values.delete(key)
  };
  const accountA = createWorkspaceStore("account-a", storage);
  const time = "2026-10-15T10:00:00.000Z";
  const data = core.createEmptyWorkspace();
  data.tasks.push({
    id: "account-a-task", title: "ACCOUNT_A_PRIVATE_TASK", projectId: "", status: "To do", dueDate: "", createdAt: time, updatedAt: time
  });
  accountA.save(data);

  const saveStatus = fakeElement();
  const shell = { querySelector: (selector) => selector === "#saveStatus" ? saveStatus : null };
  const root = fakeElement();
  const htmlWrites = [];
  let html = "";
  Object.defineProperty(root, "innerHTML", {
    get: () => html,
    set(value) { html = value; htmlWrites.push(value); }
  });
  root.closest = () => shell;
  root.querySelector = (selector) => selector === "#viewTitle" ? { focus() {} } : null;
  root.contains = () => false;
  root.replaceChildren = () => { root.innerHTML = ""; };

  const body = { append() {} };
  const document = { body, activeElement: null, createElement: fakeElement, querySelector: () => null };
  const window = { addEventListener() {}, scrollTo() {} };
  const lockRequests = [];
  const navigator = {
    locks: {
      request(name, options, callback) {
        assert.ok(options.signal, "queued writes must use the workspace abort signal");
        assert.equal(options.signal.aborted, false);
        const request = { name, signal: options.signal, callback, aborted: false };
        lockRequests.push(request);
        return new Promise((resolve, reject) => {
          request.resolve = resolve;
          options.signal.addEventListener("abort", () => {
            request.aborted = true;
            const error = new Error("Queued write cancelled by account change");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }
    }
  };

  // VM object literals belong to another realm. Convert only the editable data
  // argument so the real core's strict plain-object validation remains active.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const context = {
    ...core,
    createRecord: (workspace, kind, fields) => core.createRecord(workspace, kind, plain(fields)),
    updateRecord: (workspace, kind, id, fields) => core.updateRecord(workspace, kind, id, plain(fields)),
    createWorkspaceStore,
    document, window, navigator, AbortController, URL, setTimeout, clearTimeout,
    CSS: { escape: String }
  };
  const source = originalSource
    .replace(/^\s*import\b[^;]+;\s*/gm, "")
    .replace(/\bimport\.meta\.url\b/g, JSON.stringify(moduleUrl.href))
    .replace(/\bexport\s+function\s+mountWorkspace\b/, "function mountWorkspace");
  new vm.Script(`${source}\nglobalThis.testMountWorkspace = mountWorkspace;`, { filename: moduleUrl.pathname })
    .runInNewContext(context);
  const instance = context.testMountWorkspace(root, { uid: "account-a", store: accountA, storage });
  assert.match(root.innerHTML, /ACCOUNT_A_PRIVATE_TASK/, "the old account must render before its write is queued");

  return { root, saveStatus, instance, accountA, storageWrites: () => storageWrites, htmlWrites, lockRequests };
}

for (const [name, target] of [
  ["task completion toggle", { dataset: { taskToggle: "account-a-task" }, checked: true }],
  ["task status select", { dataset: { taskStatus: "account-a-task" }, value: "Done" }]
]) {
  test(`a queued ${name} cannot redraw the old account after destruction`, { timeout: 2000 }, async () => {
    const harness = lifecycleHarness();
    const change = harness.root.listeners.get("change");
    assert.equal(typeof change, "function");
    const originalData = harness.accountA.load();
    const writesBefore = harness.storageWrites();

    const pendingChange = change({ target });
    assert.equal(harness.lockRequests.length, 1, "the change must actually suspend on a queued Web Lock");
    assert.equal(harness.lockRequests[0].name, `velita-write:${harness.accountA.key}`);
    assert.equal(target.disabled, true);

    harness.instance.destroy();
    assert.equal(harness.lockRequests[0].signal.aborted, true);
    assert.equal(harness.lockRequests[0].aborted, true);
    assert.equal(harness.root.innerHTML, "", "destruction clears old account content immediately");

    const accountBMarker = '<div data-account="b">ACCOUNT_B_WORKSPACE</div>';
    harness.root.innerHTML = accountBMarker;
    harness.saveStatus.textContent = "ACCOUNT_B_SAVE_STATUS";
    const renderCount = harness.htmlWrites.length;
    await pendingChange;

    assert.equal(harness.root.innerHTML, accountBMarker, "the old async handler must not replace the new account's content");
    assert.equal(harness.htmlWrites.length, renderCount, "no old-account render may run after destruction");
    assert.equal(harness.saveStatus.textContent, "ACCOUNT_B_SAVE_STATUS");
    assert.equal(harness.storageWrites(), writesBefore, "the cancelled write must not persist changes");
    assert.deepEqual(harness.accountA.load(), originalData);
  });
}
