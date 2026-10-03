# Production frontend: build the Vite app, then serve it (and proxy /api) with Caddy, which also handles HTTPS.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
# The Caddyfile is mounted by docker/docker-compose.prod.yml.
