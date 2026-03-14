# Build from monorepo root: docker build -f packages/api-server/Dockerfile .
# ── Build stage ─────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY packages/api-server/package.json ./
RUN npm install

COPY packages/api-server/tsconfig.json ./
COPY packages/api-server/src/ ./src/

RUN npm run build

# ── Production stage ───────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY packages/api-server/package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Circuit artifacts — copied from monorepo at build time
COPY packages/circuits/target/vk ./circuits/target/vk
COPY packages/circuits/target/circuits.json ./circuits/target/circuits.json

ENV NODE_ENV=production
ENV PORT=3001
ENV CIRCUIT_PATH=/app/circuits/target/circuits.json
ENV VK_PATH=/app/circuits/target/vk

EXPOSE 3001

CMD ["node", "dist/index.js"]
