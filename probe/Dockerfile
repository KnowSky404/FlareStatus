FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.json ./

RUN corepack enable
RUN pnpm install --no-frozen-lockfile

COPY src ./src

RUN pnpm run build

CMD ["node", "dist/index.js"]
