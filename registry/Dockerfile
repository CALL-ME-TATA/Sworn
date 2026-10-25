FROM node:22-slim
WORKDIR /srv/registry
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 3002
CMD ["node", "server.js"]
