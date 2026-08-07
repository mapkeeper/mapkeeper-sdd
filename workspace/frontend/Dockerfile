FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=""
ARG VITE_API_MOCKING=true
ARG VITE_MOCK_SCENARIO=default
ARG VITE_SHOW_DEVELOPER_TOOLS=false

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_MOCKING=$VITE_API_MOCKING \
    VITE_MOCK_SCENARIO=$VITE_MOCK_SCENARIO \
    VITE_SHOW_DEVELOPER_TOOLS=$VITE_SHOW_DEVELOPER_TOOLS

RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080
