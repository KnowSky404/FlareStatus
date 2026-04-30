FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY bun.lock package.json tsconfig.json ./
COPY probe/package.json ./probe/package.json

RUN bun install --frozen-lockfile

COPY migrations-postgres ./migrations-postgres
COPY public ./public
COPY scripts ./scripts
COPY src ./src

EXPOSE 3000

CMD ["sh", "-lc", "bun run scripts/migrate.ts && bun run src/server.ts"]
