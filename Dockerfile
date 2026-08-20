# Single-container build: Vite frontend + Express backend serve from one image.
#
# ─── Frontend build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── Backend dependencies ───────────────────────────────────────────────────
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production

# ─── Runtime image ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY --from=frontend-builder /app/frontend/dist ./src/public
EXPOSE 3001
CMD ["node", "src/index.js"]
