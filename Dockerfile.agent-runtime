FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY packages ./packages
COPY apps/agent-runtime ./apps/agent-runtime
RUN npm install
RUN npm run -w @arena/shared build && npm run -w @arena/agent-runtime build
EXPOSE 4100
CMD ["npm", "run", "-w", "@arena/agent-runtime", "start"]
