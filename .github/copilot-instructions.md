# LikeCoin API Public - Copilot Instructions

## Repository Overview

**likecoin-api-public** is the like.co public API server - a Node.js/TypeScript Express API for OAuth, user management, NFT minting (LikerNFT), wallet integration, Stripe payments, and blockchain operations (Cosmos, Ethereum).

**Stack:** Node.js ≥20 | TypeScript 5.0.4 (ES2020, Node16 modules) | Express | AVA tests | ESLint (Airbnb+TS) | CircleCI
**Size:** ~956MB | 142 TypeScript files in `src/`

## Build and Validation Commands

### Setup & Dependencies
```bash
npm install  # ~40s, peer warnings expected/safe
```

### Lint (before changes to see baseline)
```bash
npm run lint  # 714 warnings (baseline), 0 errors required
```

### Build (ALWAYS after code changes)
```bash
npm run build  # ~60-90s: clean→tsc→copy locales
```
- Deletes `dist/`, compiles TS, symlinks `dist/config → ../config`, copies `src/locales/*.json`

### Test (ALWAYS after changes)
```bash
npm test  # ~3min: stubs→build→71 tests (MUST pass)
```
- Uses test stubs (mocks firebase/cosmos/email via `test/stub/runner.js`)

### Run Server
```bash
npm run dev     # Development (nodemon, IS_TESTNET=true)
npm start       # Production (requires build first)
# Health: GET /healthz → 200 on 127.0.0.1:3000
```

## Project Structure

```
├── .circleci/config.yml    # CI: lint→build→server test→71 API tests→codecov
├── config/                 # Runtime JS configs (env-based), service keys (gitignored)
├── src/
│   ├── index.ts            # Express entry point
│   ├── routes/             # API routes by feature (all.ts aggregates)
│   │   ├── users/, likernft/, wallet/, cosmos/, ...
│   ├── util/               # External APIs (firebase, sendgrid, ses, cosmos, evm, oauth)
│   ├── middleware/         # Express middleware
│   ├── constant/           # Constants, contract ABIs
│   ├── locales/            # i18n JSON (en, zh, cn)
│   └── types/              # TypeScript definitions
├── test/
│   ├── api/*.test.ts       # AVA integration tests
│   ├── data/               # Test fixtures
│   └── stub/               # Mocks (runner.js orchestrates stub swapping)
├── dist/                   # Build output (gitignored), needs config symlink
├── tsconfig.json           # TS: ES2020, Node16 modules, strict (noImplicitAny:false)
├── .eslintrc.js            # Airbnb+TS, no console, no for..in
└── ava.config.cjs          # AVA config, has `require('sharp')` workaround
```

**Key Patterns:**
- Routes: `src/routes/{feature}/{endpoint}.ts` → `src/routes/all.ts` → Express
- Config: All from env vars via `config/*.js` (not TS)
- Testing: Stub system swaps real utils with mocks during test via file copying
- Build: Full rebuild every time (no incremental), symlinks config
- Error Handling: Custom `ValidationError`, centralized middleware

## CircleCI Pipeline (.circleci/config.yml)

**Test Job (runs on all commits):**
1. `npm install && npm install codecov -g`
2. `apt update && apt install rsync` (required for stub system)
3. `npm run lint` → MUST pass (714 warnings OK, 0 errors)
4. `npm run build` → MUST pass
5. `npm start` (background) + health check: `wget --retry-connrefused --waitretry=5 -t 10 http://127.0.0.1:3000/healthz`
6. `npm test` → MUST pass (71 tests)
7. Upload coverage to codecov

**Deployment:** Three targets (Rinkeby/Testnet/Mainnet) via GKE, require manual approval. Not relevant for code changes.

## Known Issues & Workarounds

1. **Sharp Loading in AVA:** `ava.config.cjs` has `require('sharp')` at top. **Never remove.** (https://github.com/lovell/sharp/issues/3164)

2. **Warnings (non-blocking):**
   - 714 ESLint warnings (baseline) - focus on new warnings only
   - LRU cache deprecation warnings during runtime
   - Peer dependency conflicts (React 17 vs 18)
   - 107 npm audit vulnerabilities (known, accepted by maintainers)

3. **Build Always Full:** `npm run build` always deletes `dist/`. No incremental builds (~60-90s each time).

4. **Config Symlink Required:** Runtime needs `dist/config → ../config`. Created by `npm run clean` (part of build).

5. **Test Stub System:** `test/stub/runner.js` backs up files, swaps in mocks, runs tests, restores. If interrupted, manual cleanup: `rm -f src/**/*.bak config/*.bak`.

6. **Locale Files Must Copy:** Build script copies `src/locales/*.json` → `dist/src/locales/`. If modified, verify copy succeeds.

## Validation Checklist

Standard sequence for code changes:
```bash
npm install          # If dependencies changed
npm run lint         # Check style (new errors only)
npm run build        # Compile (must succeed)
npm test             # All 71 tests (must pass)
```

## Quick Reference

- **No console statements** (eslint error)
- **Import without extensions** (never `.ts` or `.js`)
- **Airbnb style:** 2-space indent, LF line endings, no `var`, no `for..in`
- **Types:** Explicit preferred, `any` tolerated (warnings)
- **CI:** CircleCI only (no GitHub Actions)
- **Node:** ≥20 required
- **Module system:** Node16 (TS compiles to CommonJS-compatible ESM)

**Trust these instructions.** Only search if incomplete or incorrect. Commands are validated and sequences are tested.
