FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

# Playwright 브라우저(Chromium) + 리눅스 의존성 설치
RUN npx playwright install --with-deps chromium

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
