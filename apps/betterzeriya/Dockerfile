FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/betterzeriya/package.json apps/betterzeriya/package.json
COPY apps/betterzeriya-server/package.json apps/betterzeriya-server/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/server/package.json packages/server/package.json

RUN bun install --frozen-lockfile

FROM deps AS build

COPY . .

RUN bun run --cwd packages/client build
RUN bun run --cwd apps/betterzeriya build
RUN cd apps/betterzeriya-server && NODE=1 NITRO_PRESET=node-server bun nitro build

FROM node:24-alpine AS runtime

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/apps/betterzeriya/build ./betterzeriya-build
COPY --from=build /app/apps/betterzeriya-server/.output ./betterzeriya-server-output
COPY apps/betterzeriya-server/docker-entry.mjs ./docker-entry.mjs

EXPOSE 3000

CMD ["node", "docker-entry.mjs"]
