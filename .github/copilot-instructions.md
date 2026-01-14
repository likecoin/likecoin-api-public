# LikeCoin API Public - Copilot Instructions

## Repository Overview

**Purpose**: REST API backend for like.co platform, providing authentication, blockchain interactions (Cosmos/LikeCoin), NFT operations, user management, and OAuth services.

**Tech Stack**:
- **Language**: TypeScript (Node.js 20+)
- **Runtime**: Node.js >=20
- **Framework**: Express.js
- **Testing**: Vitest with in-memory Firebase stubs
- **Build**: TypeScript Compiler (tsc)
- **Linting**: ESLint (Airbnb base config + TypeScript)
- **CI/CD**: CircleCI
- **Deployment**: Docker (Kubernetes on GCP)

**Repository Size**: ~982MB (including node_modules), ~9000 lines of TypeScript code

## Build & Validation Commands

### Prerequisites
- Node.js >=20 (tested with v20.19.6)
- npm 10+

### Installation
```bash
npm install
```
**Important**: Installation shows many deprecation warnings and 98 vulnerabilities - these are expected from legacy dependencies. The project still builds and tests successfully.

### Development
```bash
npm run dev
# Runs tsx --watch with IS_TESTNET=true, hot-reloads on file changes
# Server runs on localhost:3000 by default
```

### Linting
```bash
npm run lint
# Runs ESLint with --fix flag on src/ and test/ directories
# ALWAYS run this before building to ensure code quality
```

### Building
```bash
npm run build
# Sequence: npm run clean && tsc && copy locale files
# Creates dist/ directory with compiled JS
# The clean script creates a symlink: dist/config -> ../config
```

**Critical**: The build process:
1. Removes and recreates `dist/` directory
2. Creates symlink `dist/config -> ../config` (required for runtime config access)
3. Compiles TypeScript to JavaScript in `dist/src/`
4. Copies JSON locale files from `src/locales/*.json` to `dist/src/locales/`

### Testing
```bash
npm run test
# Runs all Vitest tests (71 tests in 8 files)
# Tests use in-memory Firebase stubs defined in test/setup.ts
# Some network errors to external services (kickbox.com) are expected and don't fail tests
# Test timeout: 60 seconds per test
# Uses single fork mode for isolation
```

**Test Environment Notes**:
- Tests mock firebase-admin, external APIs, and config files
- Environment variable `IS_TESTNET=true` is set automatically
- All Firebase operations use in-memory stubs (test/stub/firebase)
- Network failures to external validation services are expected and handled

### Running Production Build
```bash
npm start
# Runs: NODE_ENV=production node dist/src/index.js
# Requires dist/ directory to exist (run npm run build first)
# Server listens on HOST:PORT (default 127.0.0.1:3000)
# Health check endpoint: GET /healthz
```

## Project Architecture

### Directory Structure
```
/
├── src/                    # TypeScript source code
│   ├── index.ts           # Express app entry point, server initialization
│   ├── routes/            # API route handlers (all, app, arweave, cosmos, email, etc.)
│   ├── middleware/        # Express middleware (errorHandler, slack, noCache, likernft)
│   ├── util/              # Utility functions (API helpers, OAuth, wallet operations)
│   ├── types/             # TypeScript type definitions (.d.ts files)
│   ├── constant/          # Constants (pricing, contracts, JWT, transaction types)
│   ├── locales/           # i18n JSON files (en.json, zh.json, cn.json)
│   └── assets/            # Static assets
├── test/                  # Vitest test files
│   ├── setup.ts           # Global test configuration, mocks
│   ├── api/               # API endpoint tests
│   ├── stub/              # Test stubs (Firebase in-memory implementation)
│   └── data/              # Test data fixtures
├── config/                # Configuration files (config.js, secret.js, etc.)
│   ├── config.js          # Environment-based configuration
│   └── serviceAccountKey.json  # Firebase service account (gitignored)
├── dist/                  # Build output (gitignored, created by npm run build)
├── .circleci/config.yml   # CircleCI pipeline configuration
├── tsconfig.json          # TypeScript compiler configuration
├── vitest.config.mjs      # Vitest test configuration
├── .eslintrc.js           # ESLint configuration
└── package.json           # Dependencies and scripts
```

### Key Files
- **src/index.ts**: Express application setup, middleware registration, health check endpoint
- **src/routes/all.ts**: Routes aggregator
- **config/config.js**: Runtime configuration via environment variables
- **test/setup.ts**: Critical test setup with Firebase mocks and global test configuration

### Configuration Files
- **tsconfig.json**: Target ES2020, module: node16, strict mode enabled (except noImplicitAny: false)
- **.eslintrc.js**: Extends airbnb-base + TypeScript plugin, no-console error rule
- **vitest.config.mjs**: Uses single fork mode, 60s timeout, v8 coverage provider

## CI/CD Pipeline (CircleCI)

The **test** job runs the following sequence (found in `.circleci/config.yml`):
1. `npm install` - Install dependencies
2. `npm run lint` - Lint check (must pass)
3. `npm run build` - Build the application (must succeed)
4. `npm start` (background) - Start production server
5. Wait 5 seconds, then wget health check: `http://127.0.0.1:3000/healthz`
6. `npm run test` - Run API tests (must pass)

**Key Points**:
- Build runs in Docker container: `cimg/node:20.18`
- Resource class: `medium+`
- Cache key based on package.json and package-lock.json
- Deployment jobs exist for rinkeby/testnet/mainnet (manual approval required)

## Common Patterns & Best Practices

### Code Style
- Use TypeScript for all new code
- Follow Airbnb ESLint rules with TypeScript extensions
- **No console.log statements** - use proper logging (error rule enforced)
- Use 2-space indentation
- Prefer async/await over promises
- Import extensions omitted (.ts, .js)

### Error Handling
- Use custom ValidationError class with status codes
- Error middleware in `src/middleware/errorHandler.ts` handles all errors
- Return JSON error responses with `message` and `path` properties

### Testing
- Tests are in `test/` directory mirroring `src/` structure
- All tests use Vitest, not Jest
- Mock external services in `test/setup.ts`
- Use `test/stub/firebase` for Firebase operations
- Test files end with `.test.ts`

### Configuration & Secrets
- Never commit `config/serviceAccountKey.json`
- Use environment variables for configuration (see `config/config.js`)
- Test environment uses `IS_TESTNET=true`
- Firebase connections are NOT closed in CI environment (check for `process.env.CI`)

### Common Gotchas
1. **Build symlink**: The build creates `dist/config -> ../config` symlink - don't manually create dist/config directory
2. **Locale files**: JSON locale files must be manually copied during build (not handled by tsc)
3. **Test isolation**: Tests run in single fork mode for proper isolation
4. **Network errors in tests**: External API failures (kickbox.com) in tests are expected and don't cause test failures
5. **Express deprecations**: res.clearCookie warnings about maxAge are known and can be ignored
6. **Node modules**: After `npm install`, there will be 98 vulnerabilities reported - this is expected from legacy dependencies

### Making Changes
1. **Always run `npm run lint`** before committing - it auto-fixes many issues
2. **Always run `npm run build`** to verify TypeScript compilation succeeds
3. **Always run `npm run test`** to ensure tests pass
4. **Follow the CI order**: lint → build → test
5. When adding new routes, register them in `src/routes/all.ts`
6. When adding new types, place them in `src/types/` directory
7. Update locale files if adding user-facing strings

### Environment Variables
Key environment variables used:
- `NODE_ENV`: 'production' for production builds
- `IS_TESTNET`: 'true' for development/testing
- `HOST`, `PORT`: Server binding configuration
- `FIRESTORE_*`: Firebase collection roots (see config/config.js)
- `CI`: Set in CI environment, affects cleanup behavior

## Quick Reference

**Common Commands**:
```bash
npm install              # Install dependencies (required first)
npm run lint            # Lint and auto-fix code
npm run build           # Clean, compile TypeScript, copy locales
npm run test            # Run all tests with Vitest
npm run dev             # Start development server with hot reload
npm start               # Start production server (requires build)
```

**File Locations**:
- Entry point: `src/index.ts`
- Routes: `src/routes/`
- Tests: `test/api/`
- Config: `config/config.js`
- Build output: `dist/` (auto-generated)

**Validation Checklist** (before committing):
1. ✓ Run `npm run lint` (should pass without errors)
2. ✓ Run `npm run build` (should complete successfully)
3. ✓ Run `npm run test` (all 71 tests should pass)
4. ✓ No console.log statements added (ESLint will catch this)
5. ✓ TypeScript types are properly defined
6. ✓ No config/serviceAccountKey.json committed

---

**Trust these instructions**: The commands and workflows documented here have been validated against the actual repository. Only search for additional information if these instructions are incomplete or incorrect for your specific use case.
