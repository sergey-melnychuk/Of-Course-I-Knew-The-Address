# Stage 1: Compile Solidity contracts
FROM node:22-slim AS contracts
WORKDIR /build
COPY package.json package-lock.json hardhat.config.ts tsconfig.json ./
RUN npm ci
COPY contracts/ contracts/
RUN npx hardhat compile

# Stage 2: Build frontend → single index.html
FROM node:22-slim AS frontend
RUN npm i -g pnpm
WORKDIR /build
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm config set approve-builds-automatically true \
    && pnpm install --frozen-lockfile
COPY app/ .
RUN pnpm build

# Stage 3: Build Rust backend (frontend is baked in via include_str!)
FROM rust:1 AS backend
WORKDIR /build
COPY rust-backend/ rust-backend/
COPY --from=frontend /build/dist/ app/dist/
WORKDIR /build/rust-backend
RUN cargo build --release

# Stage 4: Minimal runtime (node included for hardhat deploy)
FROM node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend /build/rust-backend/target/release/rust-backend /usr/local/bin/fund-router
COPY --from=contracts /build/ /opt/contracts/
WORKDIR /opt/contracts
EXPOSE 3001
CMD ["fund-router"]
