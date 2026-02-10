FROM node:20-bookworm-slim

WORKDIR /app

# ✅ lockfile 기반 설치
COPY package.json package-lock.json ./
RUN npm ci

# ✅ Playwright chromium + deps
RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
