FROM node:24.22.3-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1.100-bookworm AS backend
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o 10001 -g 10001 /var/lib/fieldline
COPY --from=backend /src/target/release/faultic-logistics /usr/local/bin/fieldline
COPY --from=web /src/web/dist /srv/fieldline
ENV FIELDLINE_LISTEN=0.0.0.0:8080 \
    FIELDLINE_DB=/var/lib/fieldline/fieldline.sqlite \
    FIELDLINE_DIST=/srv/fieldline
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/fieldline"]
