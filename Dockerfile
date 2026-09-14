# syntax=docker/dockerfile:1
# VP-Overwatch — one image powering web + ingest worker + waze relay.
FROM node:22-bookworm-slim AS build
WORKDIR /app/Tactical
COPY Tactical/package.json Tactical/package-lock.json ./
RUN npm ci
COPY Tactical/ ./
# NEXT_PUBLIC_* are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_PMTILES_URL=""
ARG NEXT_PUBLIC_HOME_LAT=""
ARG NEXT_PUBLIC_HOME_LNG=""
ENV NEXT_PUBLIC_PMTILES_URL=$NEXT_PUBLIC_PMTILES_URL \
    NEXT_PUBLIC_HOME_LAT=$NEXT_PUBLIC_HOME_LAT \
    NEXT_PUBLIC_HOME_LNG=$NEXT_PUBLIC_HOME_LNG \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Full Tactical tree (node_modules + build) so the workers have their deps,
# plus the tools/ relay. Web uses the self-contained .next/standalone.
COPY --from=build /app/Tactical /app/Tactical
COPY tools/ /app/tools/
WORKDIR /app/Tactical
EXPOSE 3100
CMD ["node", ".next/standalone/server.js"]
