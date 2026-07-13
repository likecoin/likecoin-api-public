# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, Cursor, etc.) working in this repository. `CLAUDE.md` is a symlink to this file, and `.github/copilot-instructions.md` redirects here.

## Repository

REST API backend for the like.co platform. Express.js + TypeScript on Node.js 24+, with Firebase Firestore as the primary datastore. Surface area covers user accounts, OAuth, Cosmos/LikeCoin chain interactions, NFT/book commerce, Stripe-backed fiat purchases, Liker Plus subscriptions, Arweave uploads, and email/notifications.

For a public-facing overview and quick start, see [README.md](./README.md).

## Commands

```bash
npm install              # Install (legacy deps; many deprecation/audit warnings are expected)
npm run dev              # tsx --watch with IS_TESTNET=true, listens on 127.0.0.1:3000
npm run lint             # ESLint --fix on src/ and test/ (airbnb-base + @typescript-eslint)
npm run build            # clean → tsc → copy locale JSON files
npm start                # NODE_ENV=production node dist/src/index.js (requires build)

npm run test             # Vitest, single fork, 60s timeout per test
npm run test:watch       # Watch mode
npm run test:ui          # Vitest UI
npm run test:coverage    # v8 coverage

# Run a single test file:
npx vitest run test/api/user.test.ts
# Run tests matching a name:
npx vitest run -t "Register"
```

CI (CircleCI, `cimg/node:24.10`) runs **lint → build → start (background) → wget /healthz → test** in that order. Replicate this sequence locally before pushing.

## Build pipeline gotchas

`npm run build` is `npm run clean && NODE_ENV=production tsc && cp src/locales/*.json dist/src/locales/`. Two non-obvious steps:

1. **`npm run clean` creates a symlink** `dist/config -> ../config` so compiled code can resolve `require('../../config/config')` against the project's `config/` directory. Don't manually create `dist/config/` — it must remain a symlink.
2. **Locale JSON files are copied manually** (tsc doesn't emit them). New files in `src/locales/` only reach prod through this final `cp`. If you add a new file extension under `src/`, update the `build` script too.

## Architecture

### Entry point — `src/index.ts`

Standard Express setup with cookies, CORS (`origin: true, credentials: true`), i18n, and a custom body-parser `verify` hook that captures `req.rawBody` **only for `/stripe/webhook`** (Stripe signature verification needs the raw bytes). New webhook endpoints that need raw bodies must extend this `verify` callback.

Graceful shutdown handles SIGTERM/SIGINT and tears down PostHog + Firebase connections — but **only when `process.env.CI` is unset**. The `CI` flag also short-circuits Firebase initialization in `src/util/firebase.ts`, so much of the test infrastructure relies on it.

### Routes — `src/routes/`

Each top-level surface is a folder; `src/routes/all.ts` mounts them all under `/`:

```
/app /arweave /civic /cosmos /email /likerland /likernft /misc /oembed /plus /slack /tx /users /wallet
```

Most folders use `index.ts` as a router that mounts subroutes (e.g. `likernft/book`, `likernft/fiat/stripe`). When adding a new surface, register it in `src/routes/all.ts`.

Route handlers stay thin and delegate to the util layer.

### Util layer — `src/util/`

`src/util/api/<surface>` mirrors the route tree and contains the actual business logic (validation, Firestore reads/writes, chain calls, Stripe orchestration). Cross-cutting helpers live at `src/util/`:

- `firebase.ts` — exports the Firestore `db` and named collection refs. **Import-time side effect:** calls `admin.initializeApp()` unless `process.env.CI` is set. Tests work by mocking this module entirely (see below).
- `jwt.ts` / `middleware/jwt.ts` — JWT verification with multi-key support. Tokens with an `azp` claim are verified using a per-OAuth-client secret looked up from Firestore (cached in an LRU). Other tokens are verified against the configured public certs (`verifySecrets`/`verifyAlgorithms`).
- `stripe.ts`, `intercom.ts`, `posthog.ts`, `sendgrid.ts`, `ses.ts`, `magic.ts`, `airtable.ts`, `gcloudPub.ts`, `gcloudStorage.ts`, `arweave/`, `cosmos/`, `evm/`, `web3/` — external integrations. Tests typically mock these.
- `ValidationError.ts` — throw `new ValidationError(message, status, payload)` from any layer; `src/middleware/errorHandler.ts` converts it into a JSON response with `{ message, ... }`.

### Configuration — `config/`

Runtime config is plain `config/config.js` (CommonJS) with values pulled from environment variables. Secrets (`config/secret.js`, `config/serviceAccountKey.json`, `config/arweave-key.json`, `config/aws.json`) are gitignored.

**Adding a config key: edit `config/config.js` only.** Tests read the *real* `config.js`, so a key with an env-driven default needs nothing else.

Two ways to control config in tests:

- **Suite-wide** — set `process.env.*` at the top of `test/setup.ts`, before any import. `config/config.js` reads env at import time, so this is the only thing that reaches the whole suite.
- **Per-file** — `vi.mock('../../config/config', () => ({ ... }))` in an individual test file, as `test/util/kms.test.ts` and `test/middleware/alchemy-sponsorship-webhook.test.ts` do. The factory replaces the *entire* module, so only the keys you list exist — fine for a narrow unit test, not for the `test/api/` suites.

The catch is path depth: `vi.mock` resolves relative to the calling file and only intercepts when it lands on the same resolved module as the source file's import. Source files two levels deep import `'../../config/config'` → `<repo>/config/config.js`, and a test at `test/<dir>/*.test.ts` is also two levels deep, so the same specifier hits the same file. A one-level-deep caller (`test/setup.ts`) resolves `'../../config/config'` *outside* the repo — it registers a mock nobody imports and fails silently. That is exactly why the old `setup.ts` config mock was dead and got deleted; don't reintroduce it there.

Many keys are `FIRESTORE_*_ROOT` collection roots — they're env-driven so testnet vs. mainnet collections don't collide.

### TypeScript

- `target: es2020`, `module: node16`, `strict: true` but **`noImplicitAny: false`**. `skipLibCheck: true`.
- Custom type roots include `src/types/` (in addition to `node_modules/@types`). New `.d.ts` files belong there.
- ESLint rule `no-console: error` is enforced. Existing `console.*` calls have inline `// eslint-disable-next-line no-console`. Use the project's logging utilities (`logServerEvents.ts`, `gcloudPub.ts`, `slack.ts`) for real telemetry instead.

## Testing

Vitest, single-fork pool (`pool: 'forks'`, `singleFork: true`) so tests share state safely. Test files: `test/**/*.test.ts`. The setup file `test/setup.ts` is loaded globally and:

- Sets `IS_TESTNET=true`.
- `vi.mock`s `firebase-admin`, `../src/util/firebase` (replaced with the in-memory stub at `test/stub/firebase.ts`), `@sendgrid/mail`, `@aws-sdk/client-ses`, `../src/util/cosmos/api`, `../src/util/api/likernft/likePrice`, and `../src/util/fileupload`. It does **not** mock `config/config` — see [Configuration](#configuration--config) for why that has to happen per-file.
- Resets the in-memory Firestore stub before every test from JSON fixtures in `test/data/` (`user.json`, `subscription.json`, `tx.json`, `mission.json`, `likernft.json`).

When adding new mocks, add them in `test/setup.ts`, not in individual test files — the one exception is `config/config`, which only works per-file (see above). When adding new fixtures, place them in `test/data/` and load them via `test/stub/firebase.ts`.

External network calls in tests (e.g. `kickbox.com`) are expected to fail and don't fail the suite.

## Conventions

- **Editing scope** (per global instructions): only modify code related to the request. Don't refactor or "clean up" untouched comments and logic.
- **Commits**: follow the existing gitmoji style — `git log --oneline | head -20` to confirm. Recent examples: `🐛 Pick free priceIndex…`, `✨ Store buyerEmail…`, `🚸 Extend Intercom JWT…`.
- **Pre-commit checklist**: `npm run lint && npm run build && npm run test`. The build catches type errors that the editor sometimes misses because of `node16` resolution quirks.
- **Adding routes**: create the handler under `src/routes/<surface>/`, register it in the surface's `index.ts`, and put logic under `src/util/api/<surface>/`. Mount new top-level surfaces in `src/routes/all.ts`.
- **i18n**: user-facing strings go through `i18n` and JSON files in `src/locales/`. Adding strings means editing every `<lang>.json` file (and remember the build copies these).
- **Comments**: keep concise, at most 3 lines. Avoid breaking lines mid-sentence; break at punctuation when needed.
