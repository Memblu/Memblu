FROM node:22-alpine

WORKDIR /app

# Copy package definition and install dependencies
COPY PhotopBackend/package*.json ./PhotopBackend/
WORKDIR /app/PhotopBackend
RUN npm ci --omit=dev

# Copy source code and frontend
WORKDIR /app
COPY PhotopBackend ./PhotopBackend
COPY PhotopFrontend ./PhotopFrontend

WORKDIR /app/PhotopBackend

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npx", "tsx", "src/server.ts"]
