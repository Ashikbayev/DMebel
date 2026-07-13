# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
MebelOFF — a client-side, single-page web app (Russian furniture cost calculator + CRM) plus a Google Apps Script backend. There is no build step: `index.html` loads `main.js`, `wardrobe.js` (ES module), `backup.js`, `crm.js` directly, and pulls `three` / Tabler icons from CDNs. `Code.gs` is the Apps Script backend (Google Sheets); it cannot run locally, but the app has fallback data so the calculator works fully offline in the browser.

### Running the app (dev)
- Serve the static files, e.g. `npm run serve` (which runs `python3 -m http.server 8000`), then open `http://localhost:8000/index.html`. The wardrobe 3D configurator is `wardrobe-configurator.html`.
- The app fetches data from a Google Apps Script URL on load. Without network/backend access it falls back to built-in defaults — this is expected and the calculator still works.

### Tests
- `npm run test:core` (`node test-wardrobe-core.js`) — pure geometry tests, no dependencies, all pass.
- `npm run test:autoslots` (`node test-autoslots.js`) — requires `jsdom` (installed via `npm install`). NOTE: this test currently fails at the very start because it expects a `Шкаф`/`shk` sheet in `Code.gs` (`data.shk`), which the committed `Code.gs` does not implement. This is a pre-existing test-vs-code mismatch, not an environment problem.

### Lint / build
There is no linter config and no build system in this repo — nothing to run for lint or build.
