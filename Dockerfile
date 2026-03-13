FROM node:20-slim

WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/
COPY clawblox-projects/ ./clawblox-projects/
COPY tsconfig.json ./
COPY tsconfig.api.json ./
COPY openapi.json ./

# Install typescript for build (dev dep needed at build time)
RUN npm install --save-dev typescript tsx

# Build TypeScript
RUN npm run build:api

# Expose API port
EXPOSE 3001
EXPOSE 3002

# Default: headless API server
CMD ["node", "dist/api/server.js"]
