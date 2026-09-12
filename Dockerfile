FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
