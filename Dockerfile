# --- base ---
FROM node:20-slim

WORKDIR /app

# 1) deps 먼저
COPY package*.json ./

# ✅ lock mismatch면 ci가 터지니까 install로 간다
RUN npm install

# 2) 소스 전체 복사 (public 포함)
COPY . .

# 3) 빌드
RUN npm run build

# 4) 실행
EXPOSE 8080
CMD ["npm", "start"]
