# likecoin-api-public

[![CircleCI](https://circleci.com/gh/likecoin/likecoin-api-public.svg?style=svg)](https://circleci.com/gh/likecoin/likecoin-api-public)
[![codecov](https://codecov.io/gh/likecoin/likecoin-api-public/branch/master/graph/badge.svg)](https://codecov.io/gh/likecoin/likecoin-api-public)

REST API backend for the [like.co](https://like.co) platform. Express.js + TypeScript on Node.js 20+, backed by Firebase Firestore. Surface area covers user accounts, OAuth, Cosmos/LikeCoin chain interactions, NFT/book commerce, Stripe-backed fiat purchases, Liker Plus subscriptions, Arweave uploads, and email/notifications.

API docs: <https://api.docs.like.co/>

## Quick start

Requires Node.js >=20.

```bash
npm install
npm run dev    # tsx --watch with IS_TESTNET=true, listens on http://127.0.0.1:3000
```

Common scripts:

```bash
npm run lint          # ESLint --fix on src/ and test/
npm run build         # clean → tsc → copy locale JSON files
npm start             # NODE_ENV=production node dist/src/index.js
npm run test          # Vitest (single fork, 60s timeout per test)
npm run test:watch    # Watch mode
npm run test:coverage # v8 coverage
```

CI (CircleCI, `cimg/node:20.20`) runs **lint → build → start (background) → wget /healthz → test**. Replicate this sequence locally before pushing.

## Configuration

Runtime config lives in `config/config.js` (CommonJS, env-driven). Secrets (`config/secret.js`, `config/serviceAccountKey.json`, `config/arweave-key.json`, `config/aws.json`) are gitignored — obtain them from a maintainer before running outside CI.

## Contributing

Architecture, conventions, build pipeline gotchas, and testing setup are documented in [AGENTS.md](./AGENTS.md). Read it before making non-trivial changes.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
