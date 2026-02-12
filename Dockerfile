FROM node:20-slim

WORKDIR /app

# package 먼저 복사
COPY package*.json ./

RUN npm ci

# 전체 복사 (public 포함)
COPY . .

# 타입스크립트 빌드
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
