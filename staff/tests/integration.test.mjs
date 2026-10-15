import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createEmptyWorkspace } from "../assets/workspace-core.mjs";
import { createWorkspaceStore } from "../assets/workspace-store.mjs";

const staffRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = resolve(staffRoot, "..");
const read = (path) => readFileSync(resolve(staffRoot, path), "utf8");
const pages = ["index.html", "dashboard/index.html"];
const authHashes = {
  "index.html": "c9b195717138f1bc28d5ac7cbc47921396f624578d508a8f9b9011cffeeb0932",
  "dashboard/index.html": "9f57c4b1beaf0d8a6451e222e884eb77ed9f9172738eec5d9a1404578148a5d2"
};

function attributes(source) {
  return new Map([...source.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, key, double, single]) => [key.toLowerCase(), double ?? single]));
}

function tags(source) {
  return [...source.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/gi)]
    .map(([, name, attrs]) => ({ name: name.toLowerCase(), attrs: attributes(attrs) }));
}

function productionFiles(directory = staffRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "tests") return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? productionFiles(path) : [path];
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("the existing login and dashboard Firebase auth bodies remain byte-for-byte unchanged", () => {
  for (const page of pages) {
    const modules = [...read(page).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .filter(([, attrs, body]) => attributes(attrs).get("type") === "module"
        && body.includes("initializeApp") && body.includes("firebase-app.js"));
    assert.equal(modules.length, 1, `${page}: one original Firebase auth module is required`);
    const hash = createHash("sha256").update(modules[0][2]).digest("hex");
    assert.equal(hash, authHashes[page], `${page}: auth logic must be reviewed separately before changing its preservation baseline`);
  }
});

test("the staff shell retains unique auth hooks, accessible login fields and private indexing metadata", () => {
  const requiredIds = {
    "index.html": ["staffLoginForm", "email", "password", "togglePassword", "statusMessage", "forgotPassword"],
    "dashboard/index.html": ["authLoading", "authStatus", "userEmail", "signOutButton", "mobileSignOut", "workspaceRoot", "saveStatus"]
  };
  for (const page of pages) {
    const elements = tags(read(page));
    const ids = elements.map(({ attrs }) => attrs.get("id")).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${page}: IDs must be unique`);
    for (const id of requiredIds[page]) assert.ok(ids.includes(id), `${page}: missing #${id}`);
    const robots = elements.find(({ name, attrs }) => name === "meta" && attrs.get("name") === "robots");
    assert.ok(robots, `${page}: private page needs robots metadata`);
    const directives = robots.attrs.get("content").toLowerCase().split(/[\s,]+/);
    assert.ok(directives.includes("noindex") && directives.includes("nofollow"));
  }
  const login = tags(read("index.html"));
  for (const [id, type, autocomplete] of [["email", "email", "email"], ["password", "password", "current-password"]]) {
    const input = login.find(({ name, attrs }) => name === "input" && attrs.get("id") === id);
    assert.equal(input?.attrs.get("type"), type);
    assert.equal(input?.attrs.get("autocomplete"), autocomplete);
    assert.ok(login.some(({ name, attrs }) => name === "label" && attrs.get("for") === id));
  }
  const dashboard = read("dashboard/index.html");
  assert.match(dashboard, /\bdata-workspace-shell(?:\s|>)/);
  assert.match(dashboard, /\bdata-workspace-nav(?:\s|>)/);
  assert.match(dashboard, /href=["']#workspaceRoot["']/);
});

test("production mounting follows only Firebase account changes and starts with empty local data", () => {
  const storage = memoryStorage();
  const root = { replaceChildren() {}, append() {} };
  const app = {}, auth = {}, mounted = [], destroyed = [];
  let authCallback;
  const context = {
    document: { getElementById: (id) => id === "workspaceRoot" ? root : null },
    getApp: () => app,
    getAuth(value) { assert.equal(value, app); return auth; },
    onAuthStateChanged(value, callback) { assert.equal(value, auth); authCallback = callback; },
    mountWorkspace(element, options) {
      assert.equal(element, root);
      assert.equal(typeof options.uid, "string");
      assert.ok(options.uid);
      assert.notEqual(options.preview, true);
      const store = options.store ?? createWorkspaceStore(options.uid, storage);
      assert.deepEqual(store.load(), createEmptyWorkspace(), "production must not populate sample records");
      mounted.push({ uid: options.uid, email: options.email, key: store.key });
      return { destroy: () => destroyed.push(options.uid) };
    }
  };
  const boot = read("assets/workspace-boot.mjs").replace(/^\s*import\b[^;]+;\s*/gm, "");
  new vm.Script(boot, { filename: "workspace-boot.mjs" }).runInNewContext(context);
  assert.equal(typeof authCallback, "function");
  assert.equal(mounted.length, 0, "nothing mounts before Firebase supplies a user");
  authCallback(null);
  assert.equal(mounted.length, 0, "there is no unauthenticated fallback identity");
  authCallback({ uid: "firebase-account-one", email: "one@example.test" });
  authCallback({ uid: "firebase-account-two" });
  assert.deepEqual(mounted.map(({ uid }) => uid), ["firebase-account-one", "firebase-account-two"]);
  assert.equal(mounted[0].email, "one@example.test");
  assert.equal(mounted[1].email, "");
  assert.notEqual(mounted[0].key, mounted[1].key);
  authCallback(null);
  assert.deepEqual(destroyed, ["firebase-account-one", "firebase-account-two"], "account changes and sign-out destroy rendered workspace state");
  assert.equal(mounted.length, 2);
});

test("production routes do not contain a preview query switch or hardcoded workspace identity", () => {
  const files = productionFiles().filter((path) => [".html", ".mjs"].includes(extname(path)));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bURLSearchParams\b|\bsearchParams\b|\blocation\s*\.\s*search\b/, relative(siteRoot, file));
    assert.doesNotMatch(source, /\buid\s*:\s*["'`]/, `${relative(siteRoot, file)}: UID must come from the Firebase user`);
    assert.doesNotMatch(source, /\bpreview\s*:\s*true\b/, `${relative(siteRoot, file)}: preview must not be enabled in production`);
    assert.doesNotMatch(relative(staffRoot, file).split(sep).join("/"), /(?:^|\/)(?:preview|demo)(?:[./-]|$)/i);
  }
});

test("staff HTML, CSS and module asset references resolve within the GitHub Pages tree", () => {
  const localOrigin = "https://velita-local.invalid";
  let checked = 0;
  for (const file of productionFiles()) {
    const extension = extname(file);
    if (![".html", ".css", ".mjs"].includes(extension)) continue;
    const source = readFileSync(file, "utf8");
    const references = [];
    if (extension === ".html") {
      for (const { attrs } of tags(source)) {
        for (const name of ["src", "href"]) if (attrs.has(name)) references.push(attrs.get(name));
        if (attrs.has("srcset")) references.push(...attrs.get("srcset").split(",").map((candidate) => candidate.trim().split(/\s+/)[0]));
      }
    }
    if (extension === ".css") references.push(...[...source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map((match) => match[1]));
    if (extension === ".mjs") {
      references.push(...[...source.matchAll(/(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/g)].map((match) => match[1]));
      references.push(...[...source.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)].map((match) => match[1]));
    }
    for (const reference of references) {
      const url = new URL(reference, `${localOrigin}/${relative(siteRoot, file).split(sep).join("/")}`);
      if (url.origin !== localOrigin) continue;
      let target = resolve(siteRoot, `.${decodeURIComponent(url.pathname)}`);
      assert.ok(!relative(siteRoot, target).startsWith(".."), `${file}: reference leaves the published site tree`);
      assert.ok(existsSync(target), `${relative(siteRoot, file)}: missing ${reference}`);
      if (statSync(target).isDirectory()) target = resolve(target, "index.html");
      assert.ok(existsSync(target), `${relative(siteRoot, file)}: directory route has no index.html (${reference})`);
      if (url.hash && extname(target) === ".html") {
        const ids = tags(readFileSync(target, "utf8")).map(({ attrs }) => attrs.get("id"));
        assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `${relative(siteRoot, file)}: missing anchor ${reference}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 20, "the staff asset graph must include HTML, fonts, imagery, CSS and local module dependencies");
});
