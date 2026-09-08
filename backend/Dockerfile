FROM node:22-alpine
WORKDIR /app
COPY backend/ ./
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["node", "server.mjs"]
