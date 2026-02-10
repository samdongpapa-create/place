FROM node:20-bookworm-slim

# 작업 디렉토리
WORKDIR /app

# 1) package.json + package-lock.json 먼저 복사
COPY package.json package-lock.json ./

# 2) lockfile 기반 클린 설치
RUN npm ci

# 3) (Playwright 사용 시) Chromium + 시스템 의존성
RUN npx playwright install --with-deps chromium

# 4) 소스 및 설정 복사
COPY tsconfig.json ./
COPY src ./src

# 5) TypeScript 빌드
RUN npm run build

# 6) 런타임 설정
ENV NODE_ENV=production
EXPOSE 3000

# 7) 실행
CMD ["node", "dist/index.js"]
