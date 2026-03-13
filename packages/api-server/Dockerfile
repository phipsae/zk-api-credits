# ── Build stage ─────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ───────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Circuit artifacts (verification key + compiled circuit)
# Mount or copy these at runtime if verifying proofs server-side
# COPY ../circuits/target/vk ./circuits/vk
# COPY ../circuits/target/circuits.json ./circuits/circuits.json

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
