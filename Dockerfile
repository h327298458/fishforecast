FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/app/data/tideline.db
COPY package*.json ./
RUN npm ci --include=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/data/raw/tides /app/seed-data/tides
COPY --from=build /app/tsconfig.node.json ./
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/index.ts"]
