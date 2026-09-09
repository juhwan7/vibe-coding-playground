FROM node:22-alpine
WORKDIR /app
COPY backend/ ./
COPY backend/data/themes.kr.json /app/static/themes.kr.json
ENV NODE_ENV=production PORT=8787 THEME_CATALOG_PATH=/app/static/themes.kr.json
RUN test -r /app/static/themes.kr.json
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "runtimeBootstrap.mjs"]
