# Single-container build: Vite frontend + Express backend serve from one image.
#
# ─── Frontend build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Versionsangabe für die Sidebar – im Release-Workflow auf den Git-Tag gesetzt
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# Einziges gültiges Lockfile ist das des Root-Workspace; npm ci braucht dazu
# die package.json aller Workspaces.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# npm ci statt npm install: npm install darf das Lockfile aktualisieren, der
# Produktionsbuild waere damit nicht reproduzierbar (Befund E7).
RUN npm ci --workspace frontend
COPY frontend/ ./frontend/
RUN npm run build --workspace frontend

# ─── Backend dependencies ───────────────────────────────────────────────────
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# --production ist die veraltete Form; --omit=dev ist die aktuelle.
# Das Laufzeit-Image legt das Backend flach nach /app: Pakete, die npm wegen
# Versionskonflikten unter backend/node_modules ablegt (z. B. dotenv), gehören
# dort nach oben, die Workspace-Symlinks entfallen.
RUN npm ci --omit=dev --workspace backend \
  && if [ -d backend/node_modules ]; then cp -a backend/node_modules/. node_modules/; fi \
  && rm -f node_modules/backend node_modules/frontend

# ─── Runtime image ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
# Wartungsskripte (import:fotos, dsgvo:retention) laufen per
# `docker compose run` im selben Image, siehe README.
COPY backend/scripts ./scripts
COPY --from=frontend-builder /app/frontend/dist ./src/public
EXPOSE 3001
# /api/health meldet erst "ok", wenn die Schema-Migration durch ist (Befund A3).
# Ohne HEALTHCHECK kann `restart: always` ein hängendes oder schema-kaputtes
# Backend nicht von einem gesunden unterscheiden.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
