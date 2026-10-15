# Staff workspace verification — 15 October 2026

## Scope

This report records local pre-publication verification. No Firebase settings/rules changes or public-site edits were made. Existing inline login and dashboard authentication modules are byte-for-byte identical to the repository baseline; regression tests check their hashes.

## Automated checks

19 built-in Node test groups pass. Coverage includes immutable CRUD, strict imports, field/date validation, prototype/accessor rejection, duplicate IDs and broken links, account namespace isolation, corrupt-data preservation, storage failures, backup round-trips and exact 10 MiB serialization boundaries. Integration tests cover auth source preservation, required DOM hooks, real-UID-only production initialization, account-switch cleanup, production preview exclusion and local asset resolution. Two additional lifecycle tests execute the actual UI handlers to verify that queued task saves aborted during an account switch cannot redraw previous-account records or alter the new account's UI/data.

JavaScript module syntax checks and `git diff --check` pass. Tracked changes are confined to the two staff HTML files; new deployable files are under `staff/` only. CNAME, public pages, sitemap and public assets are unchanged.

## Browser checks

The local preview uses an explicitly labelled, separate sample-data namespace outside the repository. No fallback identity or preview switch exists in production.

- Created, edited, archived and restored a project.
- Added a project-linked task; set a due date and status; completed and reopened it; verified project progress and overview counts.
- Created and edited a linked note. Literal HTML-like text remained plain text.
- Verified project search/archive filtering and combined task search/status filtering.
- Reloaded the page and confirmed saved records persisted.
- Exported a JSON backup through the UI and validated the downloaded file against the strict schema (3 projects, 5 tasks, 2 notes at that snapshot). Import/schema/replacement behavior is covered by automated tests and code review; the native file-picker import flow was not exercised end-to-end.
- Tested two open views: changing a project in one while a draft was open in another caused the stale save to be rejected, without overwriting saved records. Inline error messaging was then clarified.
- Verified the real signed-out `/staff/dashboard/` route redirected to `/staff/`.
- Tested Show/Hide password and the empty-email password-reset message without submitting credentials or sending a reset email.
- Confirmed the existing local fonts and ribbon artwork load.
- No console errors/warnings observed in the workspace preview.

## Responsive and visual checks

Reviewed desktop at 1440 px and the laptop login at 1280 × 720. The laptop login fits fully: document height 720 px, wordmark top 24 px, no horizontal overflow.

Verified actual iframe document widths of 320, 390 and 768 px for both workspace and login, with no horizontal overflow. The responsive harness is outside the deployable repository and uses the same production CSS/modules. A 120-character unbroken project title fit at 320 px without overflowing.

The overview retains the Living Signature ribbon while working screens use cream surfaces and brown navigation. The phone layout adapts to top navigation and stacked content. Inputs remain 16 px, mobile task targets are enlarged, native dialogs retain keyboard semantics, and CSS respects reduced-motion preferences. This is not a formal accessibility conformance audit or a physical-device Safari test.

## Important limits

- Data is browser-local, not cloud-synced or shared between staff accounts/devices.
- Local storage is not encrypted; account namespaces are not a server-side security boundary.
- Real authenticated CRUD/sign-out was not exercised with a user credential. Existing auth source is preserved, its signed-out guard is browser-verified, and mounting/account transitions are covered with Firebase stubs.
- Web Locks serialize writes where available. Older browsers without Web Locks should use one editing tab at a time.
- No accounts, roles, security permissions, hosting or Firebase backend have been provisioned.

## Evidence

Screenshots are in the task workspace `outputs/` directory, outside this repository:

- `velita-staff-desktop.png`
- `velita-staff-mobile.png`
- `velita-staff-laptop-check.png`

Pre-publication checks complete. Deployment is recorded separately in GitHub Pages history.
