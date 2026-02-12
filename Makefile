.PHONY: build smart-contracts build-frontend build-backend clean

# Build the single deployable binary (frontend baked into the Rust server).
build: smart-contracts build-frontend build-backend

smart-contracts:
	npm i
	npx hardhat compile

build-frontend:
	cd app && pnpm install && pnpm build

build-backend:
	cd rust-backend && cargo build --release

docker:
	docker-compose up -d --build

clean:
	rm -rf app/dist app/node_modules/.vite
	cd rust-backend && cargo clean
