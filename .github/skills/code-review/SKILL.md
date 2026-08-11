---
name: code-review
description: Review conventions and known false positives for the likecoin-api-public Express/TypeScript API. Use when reviewing changes to routes, zod request or response schemas, Firestore reads, config keys, external webhooks, Slack notifications, or tests.
---

# Reviewing likecoin-api-public

Architecture, commands, and contributor conventions live in [`AGENTS.md`](../../../AGENTS.md);
testing conventions live in [`test/CLAUDE.md`](../../../test/CLAUDE.md). This file covers only what
a *reviewer* needs: the failure modes that actually recur here, and the claims that keep getting
filed but are not bugs.

## Bug classes worth flagging

### 1. Response schemas must match real Firestore data, not the TS interface

`sendValidatedJSON` (`src/util/ValidationHelper.ts`) `safeParse`s **unconditionally** and throws
`RESPONSE_SCHEMA_MISMATCH` on failure. A schema narrower than what the datastore actually holds
therefore 500s live traffic rather than failing a test.

Firestore reads enter as `any`, so `tsc` cannot catch this — it trusts an interface that may lie
about legacy documents. When a response schema is added or narrowed, check it against real
datastore shapes, including legacy variants (e.g. a field that is `boolean` on new docs and
`'signed'` on old ones). New cases belong in `test/unit/response-schemas.test.ts`.

### 2. A response schema is not a PII allowlist

Confidentiality must come from an allowlist projection — `filterUserData`, `filterUserDataMin`, or
`filterUserDataScoped` in `src/util/ValidationHelper.ts` — applied *before* the value reaches
`sendValidatedJSON`. Never `res.json({ ...rawDoc })`.

Default `z.object` schemas do strip undeclared keys, but `.passthrough()` schemas strip nothing, and
a schema that over-declares fields still leaks. Flag any endpoint returning a raw user or Firestore
document, especially unauthenticated ones: `/wallet/evm/migrate/user/addr/:likeWallet` returned
email, phone, and Stripe customer/subscription IDs until it was wrapped in `filterUserDataMin`.

### 3. External webhook request schemas must be lenient

`validateBody` rejects with 400 **before** the handler runs, and a 400 can make the provider drop or
stop retrying a genuine event. For externally-controlled bodies (RevenueCat, Stripe, Slack):

- `z.string()`, not `z.enum()`, for provider enums.
- `.nullish()`, not `.optional()` — providers send explicit `null`, which `.optional()` rejects.
- `.passthrough()` at every object level, so new provider fields pass through untouched.
- Only genuinely-always-present fields required.

Verify nullability and enum values against the **provider's own docs**, not the repo's TypeScript
interface — those drift. `RevenueCatEvent` was missing `period_type: 'PREPAID'` long after RevenueCat
started sending it; it was only added once a live payload forced the issue.

Authentication (shared secret / HMAC) is the trust boundary and belongs in middleware ordered
*ahead* of `validateBody`.

### 4. `validateQuery` / `validateParams` reassign `req[target]`

`src/middleware/validate.ts` assigns the parse result back onto the request, so anything the schema
omits is dropped for every later reader:

- Query schemas need `.passthrough()`, or unlisted params vanish downstream.
- Params schemas must list **every** `:param` on the route.
- Keep handler-guarded fields `.optional()`. Many handlers throw specific errors (`MISSING_TOKEN`,
  `WALLET_NOT_SET`, `UNSUPPORTED_CURRENCY`); a required schema field replaces those with a generic
  `INVALID_INPUT`.
- Numeric path/query values need `z.coerce.number()` — everything arrives as a string.

### 5. A new config key is `undefined` in production

The `config/config.js` that runs in prod is supplied by the deployment (a k8s ConfigMap in the
`likecoin-deployment` repo), not by this one. Adding a key here — even with a `|| 'default'` — leaves
it `undefined` in prod until it is added deployment-side too.

For keys consumed by a third-party SDK, repeat the default at the use site, since the failure
surfaces as an opaque error inside the library rather than a missing-key message.

### 6. Slack notification links must always be valid URLs

Link fields in Slack Workflow payloads are bound to `Open link` buttons, which require a present,
valid URL. `axios.post` serializes with `JSON.stringify`, which **drops keys whose value is
`undefined`**, and Slack then fails the step with `parameter_validation_failed`. The API never sees
it — the POST succeeds and the error happens Slack-side.

Never `undefined`, never `''`, never `'N/A'`. Every code path needs a real fallback URL.

### 7. `no-console` is an error

Use `src/util/logServerEvents.ts`, `gcloudPub.ts`, or `slack.ts`. Existing `console.*` calls carry an
inline eslint-disable; new ones should not be added.

## Known false positives — do not report these

**"This config key is missing from the test config mock."** There is no config mock. The
`vi.mock('../../config/config', …)` block in `test/setup.ts` was deleted because it silently
resolved to a path *above* the repo root that nothing imports — it never took effect. Tests read the
real `config/config.js`; setting `process.env.*` at the top of `test/setup.ts` is the only lever.
Adding a config key requires editing `config/config.js` and nothing else.

**"`plusAffiliateFrom` is stale — clear it when a user resubscribes without an affiliate."**
Intentional product behavior. Attribution persists across resubscribe so the original affiliate
keeps credit. A clear-on-empty fix was implemented once and reverted for contradicting product
intent. `plusAffiliateFrom` is write-only-when-present in `processStripeSubscriptionInvoice`
(`src/util/api/plus/index.ts`).

## Scope

Report defects in the diff. Do not propose refactors, renames, or cleanups of surrounding code that
the change did not touch.
