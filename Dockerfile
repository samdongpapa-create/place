# ✅ 가장 안정적인 방법: Playwright 공식 이미지 (Chromium + deps 포함)
FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

# ✅ Playwright 이미지에는 브라우저가 이미 포함되어 있으니, 재다운로드 방지
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

# ✅ lockfile 기반 설치
COPY package.json package-lock.json ./
RUN npm ci

# ✅ 빌드
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
