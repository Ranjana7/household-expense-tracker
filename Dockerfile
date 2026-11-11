FROM node:22-alpine AS ui-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS api-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server ./

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=ui-builder /app/dist ./dist
COPY --from=api-builder /app/server ./server
EXPOSE 4000
CMD ["node", "server/src/index.js"]
