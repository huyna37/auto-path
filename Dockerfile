# Lightweight Dockerfile for the dynamic-express-apis project
# Uses node:18-slim for compatibility

FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package manifests only first for cached installs
COPY package.json package-lock.json* ./

# Install only production dependencies to keep image small
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi

# Copy app source
COPY . .

# Create uploads and apis directories (server expects them)
RUN mkdir -p uploads apis && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "index.js"]
