---
name: run-likecoin-api
description: Build, run, and drive the likecoin-api-public Express server. Use when asked to start the API, boot the server, hit an endpoint, run the test suite, reproduce a route's response, or verify a handler change works against real request/response flow.
---

REST API backend (Express 5 + TypeScript, Firestore). There is no UI — you drive it
over HTTP. Use `.claude/skills/run-likecoin-api/driver.mjs`, which has two modes:
`smoke` (boots the real server and probes it) and `req` (drives one endpoint against
the in-memory Firestore stub, where handler logic is actually reachable).

All paths below are relative to the repo root.

## The credential problem — read this first

`src/util/firebase.ts:56` calls `admin.initializeApp()` **at import time**. It reads
`config/serviceAccountKey.json` — a tracked placeholder whose credential fields are all
empty strings — so on a fresh checkout `initializeApp()` throws and the server crashes
before Express binds a port:

```
FirebaseAppError: Service account object must contain a string "project_id" property.
```

`src/util/firebase.ts:55` guards that whole block behind `if (!process.env.CI)`, and
`getCollection()` returns `{}` when `CI` is set. **`CI=1` is the only way to boot this
server without real Google credentials.** That's what CircleCI's `npm start` step relies
on, and it's what the driver does.

The tradeoff: under `CI=1` there is no database, so any handler that touches Firestore
returns 500. For handler logic, use `driver.mjs req` instead (next section).

## Prerequisites

Node 24+ (`engines: >=24`). No system packages needed.

```bash
node -v        # v24.15.0
npm install
```

## Build

```bash
npm run build
```

`npm run clean` recreates `dist/config` as a **symlink** to `../config` — don't
replace it with a real directory or compiled `require('../../config/config')` breaks.

## Run (agent path)

### Drive a single endpoint with a working database — `req`

This is the mode you want for verifying a handler change. It runs the request through
`test/api/axiosist.ts`, which rebuilds the Express app on the in-memory Firestore stub
seeded from `test/data/*.json`. No credentials, no port, ~3s per call.

```bash
node .claude/skills/run-likecoin-api/driver.mjs req GET /users/id/testing/min
```
```json
{
  "status": 200,
  "data": {
    "user": "testing",
    "displayName": "testing",
    "wallet": "0x4b25758E41f9240C8EB8831cEc7F1a02686387fa",
    "isCivicLikerTrial": true,
    "civicLikerSince": 1546272000000
  }
}
```

Authenticated — `--user <id>` and/or `--wallet <addr>` sign a JWT with the test secret:

```bash
node .claude/skills/run-likecoin-api/driver.mjs req GET /users/preferences --user testing
# 200 {"locale":"en","creatorPitch":"I am your father.","paymentRedirectWhiteList":[]}
# Without --user: 401 "LOGIN_NEEDED".
```

With a body:

```bash
node .claude/skills/run-likecoin-api/driver.mjs req POST /users/new/check --body '{"user":"testing"}'
# 400 {"error":"USER_ALREADY_EXIST","alternative":"testing38396"}   (suffix is random)
```

Pass the **production** path (`/users/...`). The driver adds the `/api` prefix that
axiosist mounts under — see Gotchas.

Seeded fixture identities live in `test/data/user.json` (`testing`, `testing1`, …),
plus `likernft.json`.

### Boot the real server — `smoke`

Proves the process starts, routes are mounted, and middleware works. Firestore is
absent, so DB-backed routes are expected to 500.

```bash
node .claude/skills/run-likecoin-api/driver.mjs smoke
```
```
booting: CI=1 IS_TESTNET=true npx tsx src/index.ts
ok   200  /healthz                     OK
ok   302  /                            Found. Redirecting to https://api.docs.like.co/
ok   200  /misc/price                  {"price":0.00203916}
ok   404  /no-such-route               <!DOCTYPE html> ...
ok   500  /users/id/testing/min        Internal Server Error  (needs Firestore; 500 is expected under CI=1)

smoke ok
```

To keep a server up and poke it yourself:

```bash
CI=1 IS_TESTNET=true npx tsx src/index.ts &
curl -s http://127.0.0.1:3000/healthz          # OK
curl -s http://127.0.0.1:3000/misc/price       # {"price":0.00203916}
pkill -f "tsx src/index.ts"
```

## Run (human path)

`npm run dev` (tsx watch, testnet) or `npm start` (built `dist/`). **Both crash without
real credentials** — see the credential problem above. `CI=1 npm start` boots the built
server the same way `smoke` does. Only useful if you have a populated
`config/serviceAccountKey.json`.

## Test

```bash
npm run test        # 48 files, 618 tests, ~4.3s
npx vitest run test/api/user.test.ts
npx vitest run -t "Register"
```

Full CI sequence (CircleCI runs exactly this):

```bash
npm run lint && npm run build && CI=1 npm start &   # then wget /healthz
npm run test
```

## Gotchas

- **`/api` prefix mismatch.** `test/api/axiosist.ts` does `app.use('/api', allRoutes)`,
  but `src/index.ts` mounts at `/`. So the same handler is `/api/users/preferences` in
  tests and `/users/preferences` in production. `driver.mjs req` takes the production path and adds
  the prefix, so you never write `/api` yourself — but existing test files do.
- **Test JWTs are hardcoded.** `test/api/jwt.ts` signs with secret `'likecoin'`,
  audience and issuer both `rinkeby.like.co`. Nothing in `config/` needs changing.
- **`req` writes a throwaway `test/api/__driver.test.ts`** and deletes it in a `finally`.
  The stub is installed via `vi.mock` in `test/setup.ts`, so it only exists inside the
  vitest runtime — there is no way to drive the stubbed app from a plain node script.
  If a crash ever leaves the file behind, delete it: it matches `test/**/*.test.ts` and
  would be swept up by `npm run test` and `npm run lint`.
- **`/misc/price` hits the live network.** It's the one smoke route that isn't hermetic;
  it returns a real price and will fail offline.
- **macOS prints a harmless `objc[...] Class GNotificationCenterDelegate is implemented
  in both ...libgio-2.0.0.dylib` warning** on every node start, from `canvas` colliding
  with Homebrew glib. Ignore it; pipe through `grep -v objc` if it's noisy.
- **`npm run lint` runs `eslint --fix`** — it edits your working tree. Check
  `git status` after.
- **`no-console` is an error.** Existing `console.*` calls carry inline
  `// eslint-disable-next-line no-console`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FirebaseAppError: Service account object must contain a string "project_id"` on startup | Set `CI=1`. `config/serviceAccountKey.json` is a tracked placeholder with empty credential fields. |
| `npm run dev` loops "Failed running 'src/index.ts'. Waiting for file changes" | Same cause — tsx watch retries the crash forever. Kill with `pkill -f "tsx --watch src/index.ts"`. |
| Route returns 500 under `smoke` / `CI=1` | Expected if it reads Firestore (`getCollection()` returns `{}` under CI). Use `driver.mjs req` instead. |
| `driver.mjs req` returns `Cannot POST /api/...` 404 | Wrong path or method. Confirm against `grep -rn "router.post" src/routes/<surface>/`. |
| Handler works via `req` but you need a fixture that doesn't exist | Add it to `test/data/*.json`; `test/stub/firebase.ts` reloads them before every test. |
