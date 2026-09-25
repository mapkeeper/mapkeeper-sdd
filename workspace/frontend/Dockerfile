FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=""
ARG VITE_API_MOCKING=true
ARG VITE_MOCK_SCENARIO=default
ARG VITE_SHOW_DEVELOPER_TOOLS=false
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_APP_ID=""

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_MOCKING=$VITE_API_MOCKING \
    VITE_MOCK_SCENARIO=$VITE_MOCK_SCENARIO \
    VITE_SHOW_DEVELOPER_TOOLS=$VITE_SHOW_DEVELOPER_TOOLS

RUN if [ ! -f .env.production ]; then \
      printf 'VITE_FIREBASE_API_KEY=%s\n' "$VITE_FIREBASE_API_KEY" >> .env.production; \
      printf 'VITE_FIREBASE_AUTH_DOMAIN=%s\n' "$VITE_FIREBASE_AUTH_DOMAIN" >> .env.production; \
      printf 'VITE_FIREBASE_PROJECT_ID=%s\n' "$VITE_FIREBASE_PROJECT_ID" >> .env.production; \
      printf 'VITE_FIREBASE_STORAGE_BUCKET=%s\n' "$VITE_FIREBASE_STORAGE_BUCKET" >> .env.production; \
      printf 'VITE_FIREBASE_MESSAGING_SENDER_ID=%s\n' "$VITE_FIREBASE_MESSAGING_SENDER_ID" >> .env.production; \
      printf 'VITE_FIREBASE_APP_ID=%s\n' "$VITE_FIREBASE_APP_ID" >> .env.production; \
    fi

RUN for key in VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FIREBASE_APP_ID; do \
      value=$(sed -n "s/^$key=//p" .env.production); \
      test -n "$value" && test "$value" != "-"; \
    done

RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080
