FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV HOST=0.0.0.0 PORT=7000 CACHE_PATH=/data/cache.sqlite NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 7000
USER node
CMD ["node", "src/server.js"]
