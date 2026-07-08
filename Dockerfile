# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.10

# --- Build stage: full toolchain (compiles native deps: sharp, secp256k1) ---
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production
RUN npm run build
# Drop dev deps here (native binaries already built) so we can copy a
# production-only node_modules into the slim runtime without recompiling.
RUN npm prune --omit=dev

# --- Runtime stage: slim image, prod deps only, fonts ---
FROM node:${NODE_VERSION}-slim AS runtime

# Roboto + CJK fonts are needed for server-side image/PDF rendering. wget is
# only used to fetch fonts here, so purge it in the same layer (fontconfig
# stays — it resolves fonts at runtime).
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-roboto fontconfig wget ca-certificates \
  && cd /usr/local/share/fonts/ \
  && wget -O NotoSansCJKtc-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf" \
  && wget -O NotoSansCJKjp-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf" \
  && wget -O NotoSansCJKsc-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf" \
  && fc-cache -f -v \
  && apt-get purge -y --auto-remove wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Copy the prebuilt production node_modules from the builder — avoids running
# npm (and any native-module compilation) on the slim image, which lacks a
# compiler toolchain. Same Debian/glibc/node base keeps the binaries valid.
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# dist/ carries a relative symlink dist/config -> ../config, so config/
# must exist alongside it for require('../../config/config') to resolve.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

# Run node directly (exec form) so PID 1 receives SIGTERM/SIGINT and the
# app's graceful-shutdown handlers (PostHog + Firebase teardown) actually run.
USER 1337
CMD ["node", "dist/src/index.js"]
