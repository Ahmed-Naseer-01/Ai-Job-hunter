# One image, two roles: `web` (next start) and `worker` (npm run worker). See docker-compose.yml.
# NOTE: written but not built in the development environment (no Docker daemon was available). Build it once
# (`docker compose build`) and check `docker compose logs` before relying on it.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# The worker runs TypeScript through tsx, so dev dependencies are kept. This is a single-user tool, not a public image.
COPY --from=build /app /app
RUN useradd --create-home --uid 10001 hunter && mkdir -p /app/data && chown -R hunter /app/data
USER hunter
EXPOSE 3000
CMD ["npm", "run", "start"]
