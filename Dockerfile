# Epic Laundry - self-contained API + current UI image. Runs anywhere Docker runs.
#
# The UI uses hashed filenames, so copying server/public/app from the repository is
# unsafe: a clean clone may contain index.html but not the matching bundle. Build it
# from webapp source in the image instead.
# Match the supported CI/runtime line. better-sqlite3 publishes a compatible
# prebuilt Linux binary for Node 22, avoiding an unnecessary compiler toolchain
# in the production image.
FROM node:22-slim AS web-build
WORKDIR /build/webapp
COPY webapp/package*.json ./
RUN npm ci --no-audit --no-fund
COPY webapp/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
COPY --from=web-build /build/server/public/app ./public/app
ENV PORT=3001 HOST=0.0.0.0 EPIC_DATA_FILE=/app/data/epic.json GSP_PROVIDER=sandbox
RUN mkdir -p /app/data
EXPOSE 3001
VOLUME ["/app/data"]
# data dir must be writable for the JSON store
CMD ["npx", "tsx", "src/index.ts"]
