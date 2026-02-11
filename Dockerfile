# =========================
# 1) Build stage (devDeps 포함)
# =========================
FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS build

WORKDIR /app

# ✅ 이미지에 브라우저 포함 (재다운로드 방지)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./

# ✅ 빌드에 필요한 devDependencies(TypeScript 포함)까지 설치
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

# ✅ 여기서 tsc 실행
RUN npm run build


# =========================
# 2) Runtime stage (prod만)
# =========================
FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./

# ✅ 런타임은 devDependencies 제외
RUN npm ci --omit=dev

# ✅ 빌드 산출물만 복사
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
