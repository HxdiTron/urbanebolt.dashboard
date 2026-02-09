# ============================================================
# UrbaneBolt Tracking Backend - Multi-stage Dockerfile
# ============================================================

# Base stage with Node.js
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Dependencies stage
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================================
# API Service
# ============================================================
FROM base AS api
ENV NODE_ENV=production
ENV SERVICE=api

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]

# ============================================================
# Worker Service
# ============================================================
FROM base AS worker
ENV NODE_ENV=production
ENV SERVICE=worker

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

CMD ["node", "dist/index.js"]

# ============================================================
# Scheduler Service
# ============================================================
FROM base AS scheduler
ENV NODE_ENV=production
ENV SERVICE=scheduler

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

CMD ["node", "dist/index.js"]

# ============================================================
# All-in-one (for development/small deployments)
# ============================================================
FROM base AS all
ENV NODE_ENV=production
ENV SERVICE=all

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
