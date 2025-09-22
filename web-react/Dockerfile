# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f yarn.lock ]; then corepack enable && yarn --frozen-lockfile; \
elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
else npm i; fi
COPY . .
RUN npm run build || yarn build || pnpm build


# --- Runtime stage ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Proxy /api/* to the api service in docker-compose
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
listen 80;
server_name _;
root /usr/share/nginx/html;
index index.html;
location / { try_files $uri $uri/ /index.html; }
location /api/ {
proxy_pass http://api:8080/;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_http_version 1.1;
proxy_set_header Connection "";
}
}
NGINX
EXPOSE 80
CMD ["nginx","-g","daemon off;"]