# syntax=docker/dockerfile:1
#
# Yana's image (fa-krug/yana-server), renamed: Node 26 alpine, a standalone
# Next build, tini as PID 1, uid 1001, SQLite on a volume. The comments in
# Yana's Dockerfile carry the measurements behind each line; the ones below are
# what matters for this app.

# ---------- deps ----------
# Node 26 to match .nvmrc (26.12.1) and package.json's engines.node -- all three
# must name the same line. 26.12.1 is the floor: it fixes CVE-2026-111497 (a
# Brotli decoder out-of-bounds write), which every fetch() of an untrusted
# Brotli body reaches -- the AI assistant reads arbitrary web pages.
FROM node:26-alpine AS deps
WORKDIR /build
# better-sqlite3 ships musl prebuilds, so this toolchain is insurance against a
# future dependency that does need a compiler. It never reaches the runtime.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# Fails on a stale lockfile rather than resolving something untested.
RUN npm ci

# ---------- builder ----------
FROM node:26-alpine AS builder
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runtime ----------
FROM node:26-alpine AS runtime
WORKDIR /app

# Refuse to ship a runtime older than the CVE fix: a Docker host holding a stale
# copy of the floating tag builds from it without pulling.
RUN node -e 'const v = process.versions.node.split(".").map(Number); \
  const min = [26, 12, 1]; \
  const cmp = v.map((n, i) => n - min[i]).find((d) => d !== 0) ?? 0; \
  if (cmp < 0) { console.error(`Node ${process.version} predates the CVE-2026-111497 fix (>= 26.12.1); pull a fresh node:26-alpine`); process.exit(1); }'

LABEL org.opencontainers.image.title="Family Planner" \
      org.opencontainers.image.description="Plan the family's year: vacation, holidays, day-care closures and finances" \
      org.opencontainers.image.source="https://github.com/fa-krug/family-planner"

# HOSTNAME: Next's standalone server binds `process.env.HOSTNAME || '0.0.0.0'`,
# and Docker sets HOSTNAME to the container id -- left alone, the server would
# not answer on localhost and the HEALTHCHECK would fail.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/family-planner.db

RUN apk add --no-cache tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /build/.next/static ./.next/static
# Redundant with file tracing, and kept on purpose: a native addon is the one
# thing a tracing regression could break with no runtime recovery, and
# re-copying a package Next already placed there is a byte-identical no-op.
COPY --from=builder --chown=nextjs:nodejs \
    /build/node_modules/better-sqlite3 ./node_modules/better-sqlite3
# The migrations, at the working directory: MIGRATIONS_FOLDER in
# src/lib/db/migrate.ts is `path.join(process.cwd(), "drizzle")`, and the app
# applies them itself at startup (src/instrumentation.ts).
COPY --from=builder --chown=nextjs:nodejs /build/drizzle ./drizzle

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
# A named volume inherits the 1001:1001 ownership above. A bind mount does not:
# `chown -R 1001:1001 ./data` on the host first, since SQLite needs to write the
# directory (for its -wal/-shm siblings), not just the file.
VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
