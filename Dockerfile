FROM node:22-alpine AS ui-build
WORKDIR /build
COPY ui/package*.json ./
RUN npm install
COPY ui/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY app/ ./app/
COPY --from=ui-build /build/dist ./ui/dist
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "app/server.js"]
