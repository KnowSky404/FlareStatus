FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY bun.lock package.json ./
COPY probe/package.json ./probe/package.json

RUN bun install --frozen-lockfile

COPY probe ./probe

WORKDIR /app/probe

CMD ["bun", "run", "src/index.ts"]
