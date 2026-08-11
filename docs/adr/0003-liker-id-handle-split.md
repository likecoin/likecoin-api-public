# ADR 0003 — Liker ID: Public Handle / Internal ID Split

- **Status:** Accepted (D4 ratified — aliasing; D6 open). Phases 1–3 implemented.
- **Date:** 2026-08-12
- **Scope:** `likecoin-api-public` (field, resolver, rename endpoint), `3ook-com` (display + short links), `publish-3ook-com` (display), `3ook-com-app` (no change required), `likecoin-cloud-functions/ebook-cors` (watermark heuristic only)

## Context

`userCollection` (`src/util/firebase.ts:67`) is keyed by Liker ID, and the public `user` field of every API response *is* the document id:

```ts
// src/util/api/users/getPublicInfo.ts:41-47
const { id } = userDoc;
payload.user = id;
let avatarUrl = `https://${API_EXTERNAL_HOSTNAME}/users/id/${id}/avatar?...`;
```

There is no rename path anywhere, and `git log` shows no prior attempt. Users who want a different handle create a second account, fragmenting their Plus subscription, book library, and wallet links.

**The field is overloaded.** One string simultaneously serves as the Firestore primary key, the JWT subject, the Intercom external id, the RevenueCat subscriber id, the OAuth subject, and the public handle. Only the last of those wants to be mutable; the other five require the opposite.

**Where the Liker ID escapes this repo.** These are the constraints that shape the decision:

- **RevenueCat `app_user_id`** — `src/util/api/plus/revenuecat.ts:106` resolves the subscriber identity from `[app_user_id, ...aliases]`, and `3ook-com-app/services/iap-bridge.native.ts:330` states the invariant outright: *"(`likerId` = Firestore doc id), since that is what the RevenueCat→backend [webhook keys on]"*. Purchase (`:334`), restore (`:382`), and sync (`:466`) all pass it. Commit `241c410e` enforces one Liker ID per RevenueCat subscription on grant, so a changed id is an active collision, not a silent one.
- **Intercom `user_id`** — `src/util/intercom.ts:51`, signed into the Intercom identity-verification token; `3ook-com-app/services/intercom-bridge.native.ts:366`.
- **OAuth subject** — `src/util/api/oauth/index.ts:13` (`user` claim in the per-client JWT) and `:35` (`oAuthClients/{clientId}/users/{likerId}`). Downstream relying parties treat this as `sub`.
- **The API's own JWT** — `src/routes/wallet/index.ts:80-84` sets `payload.user` from `getUserWithCivicLikerPropertiesByWallet(...)`, i.e. from the same `formatUserCivicLikerProperies` that emits the public field. Tokens live 30 days with **no revocation** (ADR 0002 D4, still open). Five handlers authorize by string equality on that claim: `src/routes/tx/history.ts:31,90`, `src/routes/users/getInfo.ts:51`, `src/routes/users/delete.ts:18`; `getInfo.ts:34` also uses it as a subcollection doc key.
- **Attribution carried as a bare `@handle` string** — book channel commission resolves `from` to a Stripe Connect account at transfer time, once per purchase (`src/util/api/likernft/book/purchase.ts:176`), so a link minted long ago is resolved at the moment money moves. Plus affiliate attribution stores `affiliateFrom` in Stripe subscription metadata (`src/util/api/plus/index.ts:1093`) and copies it to `plusAffiliateFrom` on the user doc **at subscription creation only** (`:525-531`); there is no recurring transfer to a Plus affiliate, so that string drives gifts, discounts and attribution rather than a payout.
- **Handles embedded in shared artifacts** — `3ook-com/shared/utils/short-link.ts:60-63` encodes the handle into the short-link segment and `:114` expands it back to `from=@handle`; `publish-3ook-com/app/composables/useAffiliationLinkMatrix.ts` generates affiliate link matrices. These URLs are printed and posted; they outlive any rename.
- **Client-cached copies** — `3ook-com/server/api/login.post.ts:87,103` bakes `likerId: userInfoRes.user` into the nuxt-auth-utils session cookie, and `3ook-com/app/composables/use-liker-info.ts:26` derives the client's whole notion of identity from `data?.user`.

**Two facts make this cheaper than it looks.** First, `3ook-com` persists **no Liker ID foreign keys in its own Firestore** — its user docs are keyed by wallet (`getUserCollection().doc(body.walletAddress)`) and its session tokens by `(wallet, jwtId)`. Every copy it holds is a cache or a session. Second, `ebook-cors` authorizes purely on the wallet claim (`index.js:242,261,268`) and resolves profiles via `/users/addr/{likeWallet}/min` (`nft/api.js:27-29`), so DRM delivery is untouched.

**The architecture is already drifting this way.** 61 resolution sites go through wallet (`getUserWithCivicLikerPropertiesByWallet`, `getBookUserInfo`, `likeNFTBookUserCollection.doc(wallet)`) against 17 through Liker ID, and ADR 0002 D1 makes `/wallet/authorize` the sole token issuer. Liker ID is already a display handle in practice; it is only the storage layout that still treats it as the identity.

## Decision

**D1 — `user` keeps its current meaning: the immutable internal id.** It is not redefined, not repurposed, and never receives a handle. Everything that keys on it today — JWT subject, Intercom `user_id`, RevenueCat `appUserID`, OAuth subject, `session` and `referrals` subcollection keys, all 46 `.doc()` call sites — continues to work with no change and no cross-repo coordination.

**D2 — The mutable handle is a new field, `handle`.** Stored on the user doc, read as `data.handle ?? doc.id`, emitted alongside `user` from the single choke point:

```ts
// src/util/api/users/getPublicInfo.ts — formatUserCivicLikerProperies
payload.user = id;                      // internal id, unchanged
payload.handle = data.handle ?? id;     // mutable, display + link surface
```

Named `handle`, **not** `likerId`, because `likerId` already denotes the *internal* id in the mobile stack (`3ook-com/app/composables/use-native-iap.ts:158`, `3ook-com-app/services/iap-bridge.native.ts:330`). Reusing it for the mutable value would invert its meaning across a repo boundary. The product-facing label remains "Liker ID"; only the code name differs.

Uniqueness is enforced by a `likerIdHandles/{handle} → { userId, status }` collection, with the claim checked and written inside the rename transaction so a concurrent claim aborts rather than clobbers. Resolution goes through one helper, LRU-cached like the per-client OAuth secrets in `src/util/jwt.ts`.

The resolver probes the **document id before the index**, which matters more than it looks: until an account renames, its handle *is* its document id, so the index is empty for effectively every user and probing it first would add a wasted read to the hottest path in the codebase (`getUserWithCivicLikerProperties`, ~67 call sites). It also returns the document snapshot rather than an id, so callers do not re-read what the resolver already fetched. Reordering is safe because a handle can never be a live document id of one account *and* an index entry of another — `isHandleAvailable` checks both namespaces before either can be claimed.

**D3 — Re-keying `users/*` to opaque document ids is rejected.** It would migrate the collection plus every subcollection and rewrite every denormalized `referrer` / `grantedBy` / `memberLikerId`, and it would **not** solve the freed-handle problem, which is independent of what the document id is. The existing Liker ID already satisfies the only two requirements an internal key has — immutable and unique. Opacity was never one of them.

**D4 — Old handles become permanent aliases. (Ratified.)** On rename the previous handle is marked `status: 'alias'`: it continues to resolve to the same account, and it can never be registered by anyone else.

Aliasing rather than retiring, because the alternative silently costs users money. `affiliateFrom: '@alice'` sits in Stripe subscription metadata and is re-resolved on every recurring invoice; short links carrying `@alice` are already printed and posted. Retiring the handle would stop those from attributing, so a rename would quietly cancel a user's recurring commission stream. Aliasing keeps the earnings intact.

The accepted cost is that a previous handle stays publicly discoverable forever. Self-serve rename therefore serves rebranding, **not** shedding an identity — see D6.

**D5 — Attribution is stored as an internal id, not a handle.** Note that D4 already removes the security argument here: because a handle is never freed, resolving one late is safe — it can only ever reach the account that owns it. What remains is a correctness problem that renaming introduces directly.

`plusAffiliateFrom` holds whatever handle was on the referral link, and `GET /plus/affiliate` compares it by string equality against the caller's own id to decide whether the affiliate *is* the caller (`src/routes/plus/index.ts:607-628`). Once one account can answer to two handles, that comparison fails and a renamed affiliate is listed twice — once as self, once as referrer. The same string-keyed dedupe exists downstream in `3ook-com/server/utils/affiliate.ts:216`.

So attribution is normalized to the internal id at write time (both the Stripe and RevenueCat paths), and readers resolve before comparing. No new field: legacy records hold a handle, which still resolves, and new ones hold the id. Payout paths need no change — `getBookUserInfoFromLikerId` resolves through the same helper and therefore honours aliases automatically.

**D6 — Opaque internal ids for new accounts. (OPEN — recommended.)** For every existing user the internal id *is* their old handle, and it is visible in the JWT (which ADR 0002 Invariant 2 treats as client-readable), in Intercom, and in the RevenueCat dashboard. Combined with D4 that is fine for a rebrand and wrong for someone renaming to escape a deadname or a harassment campaign.

Issuing an opaque internal id at registration (`handleUserRegistration`) makes the split clean going forward and leaves only legacy accounts carrying a handle-shaped key. `suggestAvailableUserName` already picks the handle separately, so the two concerns are nearly disentangled already. The escape case for legacy accounts needs a rare, manual internal-id reissue that re-links RevenueCat and Intercom by hand — admin-operated, not self-serve.

**D7 — The JWT claim stays the internal id; route params are resolved before comparison.** The five equality checks in D-context become `resolveUserIdByHandle(req.params.id) === req.user.user`. This is the only unavoidable authorization change, and it is bounded to those sites. Nothing else about token issuance, lifetime, or the open revocation question in ADR 0002 D4 is touched — which is the point: keeping `user` immutable means a rename cannot be undermined by a 30-day unrevocable token.

## Invariants

1. **`user` is immutable.** Any sink that keys on identity — RevenueCat, Intercom, OAuth, session and referral subcollections — receives `user`, never `handle`. A handle reaching one of these is a defect.
2. **Handles are never freed.** Every handle ever issued stays bound to its account, as `active` or `alias`, permanently. There is no expiry and no reclamation.
3. **Identity comparisons use internal ids.** Two handles can name one account, so any equality check, dedupe key, or attribution record uses the resolved internal id — never the handle string.
4. **One rename per account.** Enforced by the presence of the `handle` field itself, inside the rename transaction, and audit-logged with old handle, new handle, and timestamp.
5. **The public read path has one choke point.** `formatUserCivicLikerProperies` is the only place that decides what `user` and `handle` contain. Adding a second is how the two meanings drift apart again.

## Phased rollout

1. **Index and resolver — done.** `handle` on the user doc, the `likerIdHandleCollection` index, `resolveUserIdByHandle()` in `src/util/api/users/handle.ts`, `payload.handle` emitted from the choke point, and the self-authorization checks resolved through `isSameUser()`. No backfill: a handle with no index row falls back to a document lookup, so rows appear only when a rename happens.
2. **Attribution normalization (D5) — done.** `plusAffiliateFrom` is written as an internal id on both the Stripe and RevenueCat paths, and `GET /plus/affiliate` resolves before comparing while still emitting the current handle for link building.
3. **Rename endpoint — done.** `POST /users/handle` (once per account, audit-logged to `eventUserHandleChange`) and `GET /users/handle/:handle/available`.
4. **Consumer adoption — not started.** `3ook-com` and `publish-3ook-com` switch display surfaces and generated links from `user` to `handle` at their own pace, and `3ook-com` must bust its affiliate LRU (`server/utils/affiliate.ts:51-82`) when a rename lands. `ebook-cors` points its `user !== displayName` auto-generated-id heuristic (`customMessage.js:62`) at `handle`. `3ook-com-app` needs nothing.

## Consequences

- **Gained:** users can change their public handle without forking their account; the identity field stops carrying six meanings; the Liker ID stops being a structural blocker on the wallet-as-identity direction in ADR 0002.
- **Unchanged, by construction:** JWT issuance and verification, Intercom identity, RevenueCat subscriber mapping, OAuth subjects, `3ook-com`'s session cookie, and the entire `3ook-com-app` and `ebook-cors` surface. Three of the four sibling repos need no changes at all.
- **Accepted:** a permanent, non-collectable alias table; one extra cached read on handle resolution; a previous handle that stays publicly discoverable (D4), which self-serve rename does not solve and D6 addresses only for new accounts.
- **Not reversible in data.** The code is revertible up to the first rename. After that, the alias table must be honoured forever — dropping it re-opens the handle for registration, which is exactly the account-takeover and commission-redirection vector this ADR exists to close.

## Explicitly rejected

- **Redefining `user` to mean the handle, with a new `userId` for the internal id.** The inverse of D1/D2 and the trap this ADR was written to document. `3ook-com` would cache a mutable value in a long-lived session cookie and pass it to RevenueCat as `appUserID`; a rename would create a fresh RevenueCat subscriber while the entitlement stayed on the old id, and `resolveAppUserId` would find the new id with no entitlement. A paying mobile subscriber would silently lose Plus. It also requires a coordinated deploy across four repos, which the additive form does not.
- **Freeing old handles after a cooldown.** A cooldown does not help: the artifacts that carry a handle — printed short links, `affiliateFrom` in Stripe metadata, OAuth subjects at downstream relying parties — have no expiry, so there is no window after which reissuing is safe.
- **Retiring old handles instead of aliasing (the D4 alternative).** Cleaner for the escape case, but it stops old links and existing subscriptions from attributing, cancelling a renamer's recurring commissions. Rejected in favour of D4 + D6.
- **Making the handle case-preserving.** `checkUserNameValid` (`src/util/ValidationHelper.ts:61`) is already lowercase-only and `3ook-com/shared/utils/short-link.ts:61` lowercases before matching. Introducing case here would create a second collision axis for no product benefit.

## Open questions

- **D6** — whether new accounts get opaque internal ids, and whether a manual reissue path for legacy accounts is worth building before demand exists.
- **Handle length and character set on rename.** `checkUserNameValid` bounds registration; whether a rename may take a *shorter* handle than the minimum an account originally had, or move between the legacy and current character sets, is unspecified.
- **Does any OAuth relying party outside these five repos persist the `user` claim as its own foreign key?** D1 makes this moot for the API, but a relying party that stored the handle separately for display would show a stale one. Answerable from the `oAuthClients` collection.
