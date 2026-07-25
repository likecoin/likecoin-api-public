# Testing

Vitest, single-fork pool (`pool: 'forks'`, `singleFork: true`) so tests share state safely. Test files: `test/**/*.test.ts`. The setup file `test/setup.ts` is loaded globally and:

- Sets `IS_TESTNET=true`.
- `vi.mock`s `firebase-admin`, `../src/util/firebase` (replaced with the in-memory stub at `test/stub/firebase.ts`), `@sendgrid/mail`, `@aws-sdk/client-ses`, `../src/util/cosmos/api`, `../src/util/api/likernft/likePrice`, and `../src/util/fileupload`. It does **not** mock `config/config` — see the Configuration section of the root `AGENTS.md` for why that has to happen per-file.
- Resets the in-memory Firestore stub before every test from JSON fixtures in `test/data/` (`user.json`, `tx.json`, `likernft.json`).

When adding new mocks, add them in `test/setup.ts`, not in individual test files — the one exception is `config/config`, which only works per-file (see above). When adding new fixtures, place them in `test/data/` and load them via `test/stub/firebase.ts`.

External network calls in tests (e.g. `kickbox.com`) are expected to fail and don't fail the suite.
