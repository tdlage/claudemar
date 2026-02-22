FROM node:22-slim AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:22-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.* ./
COPY src/ src/
RUN npx tsup src/main.ts --format esm

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CLAUDEMAR_DATA=/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=backend-build /app/dist ./dist
COPY --from=dashboard-build /app/dashboard/dist ./dashboard/dist

RUN mkdir -p orchestrator agents projects data

EXPOSE 3000

CMD ["node", "dist/main.js"]
