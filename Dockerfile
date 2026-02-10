# 예시: node:20-bookworm-slim 기준
FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci

# ✅ playwright + chromium 의존성 설치
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY tsconfig.json ./

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
