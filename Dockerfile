FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g npm@11.6.2
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g npm@11.6.2
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 3000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/src/server.js"]
