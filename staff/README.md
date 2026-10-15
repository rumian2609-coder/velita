# Velita staff workspace

Static, buildless staff UI for the existing GitHub Pages website. No public page, CNAME, Firebase configuration, sign-in, password reset or sign-out logic is changed. The existing Firebase modules in the login and dashboard HTML are preserved verbatim.

## Working features

- Account-gated overview using a real Firebase-provided UID; production starts empty.
- Projects: create/edit, stages, search/filter, archive/restore and permanent delete. Deleting a project retains its tasks/notes and removes their project link.
- Tasks: create/edit/delete, optional project/date, status and completion, search/filter and overdue dates.
- Notes: create/edit/delete, plain text, optional project, full-text search and filtering.
- Counts and project completion derived from saved records.
- Versioned JSON backups: export; fully validated import with explicit replacement confirmation. Imports never change the signed-in account.
- Invalid stored data is not overwritten automatically; recovery download and explicit reset are available.
- Other tabs refresh when saved data changes. Editors detect stale drafts; supported browsers serialize saves with a per-account Web Lock. On older browsers without Web Locks, keep only one workspace tab open while editing.
- Responsive layouts, native keyboard-accessible dialogs, form labels, focus states and reduced motion.

## Storage and privacy boundary

This version saves **only in the current browser**, under `velita:staff:workspace:v1:<Firebase UID>`. It is not multi-user collaboration or cloud sync. Data does not automatically follow the account to another browser/device, and browser-data clearing can remove it. Export backups regularly.

The UID namespace separates accounts in normal application use. It is **not encryption or a server-side security boundary**: someone with access to browser developer tools, the same device profile, or scripts running on this origin could read local storage. Do not store credentials, API keys or highly sensitive material here. Sign-out clears the rendered UI but deliberately retains local records for the next sign-in.

No database rules, IAM, Firebase settings or permissions were deployed. Cross-device sync and shared staff roles require a separately reviewed backend and access model. The existing authentication accepts the same accounts as before; this build does not create accounts, expand access or add sign-up.

Backups contain projects/tasks/notes and timestamps, not Firebase credentials/configuration/session tokens. Treat them as private files.

## Files

- `index.html` + `assets/login.css`: staff sign-in appearance; existing auth script unchanged.
- `dashboard/index.html`: accessible static shell; existing guard/sign-out script unchanged.
- `assets/workspace-boot.mjs`: initializes UI only after Firebase provides a real user UID. No demo/fallback identity.
- `assets/workspace.mjs`: reusable UI, CRUD/forms/search/backup controls.
- `assets/workspace-core.mjs`: strict schema, immutable record operations and import/export.
- `assets/workspace-store.mjs`: browser-local account-scoped persistence. Storage errors propagate.
- `assets/workspace.css`: staff-only design; reuses local public fonts and copies of approved ribbon artwork.

## Local review

Serve the repository with a static server and open `/staff/` to inspect the real login. Unauthenticated `/staff/dashboard/` continues to redirect to sign-in.

The task workspace also contains `work/staff-workspace-preview/`, **outside this repository**, for reviewing all workspace interactions without signing into Firebase. It has a permanent preview label, its own storage namespace, and a localhost-only guard. It is not a production route and must not be copied into the published repository. Sample records appear only there; never in production.

## Tests

Run `node --test staff/tests/*.test.mjs` from this repository. Tests use the built-in Node test runner and need no installed dependencies. Also review the workspace in a browser, including create/edit/archive/delete/reload, backup round-trips, keyboard interaction and mobile widths.

Publication is tracked in the repository's Git history and GitHub Pages deployment history.
