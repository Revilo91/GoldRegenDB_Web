# Single-container build: Vite frontend + Express backend serve from one image.
#
# ─── Frontend build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Versionsangabe für die Sidebar – im Release-Workflow auf den Git-Tag gesetzt
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY frontend/package*.json ./
# npm ci statt npm install: npm install darf das Lockfile aktualisieren, der
# Produktionsbuild waere damit nicht reproduzierbar (Befund E7).
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Backend dependencies ───────────────────────────────────────────────────
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY backend/package*.json ./
# --production ist die veraltete Form; --omit=dev ist die aktuelle.
RUN npm ci --omit=dev

# ─── Runtime image ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY --from=frontend-builder /app/frontend/dist ./src/public
EXPOSE 3001
# /api/health meldet erst "ok", wenn die Schema-Migration durch ist (Befund A3).
# Ohne HEALTHCHECK kann `restart: always` ein hängendes oder schema-kaputtes
# Backend nicht von einem gesunden unterscheiden.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
