.PHONY: build build-frontend build-backend clean docker-build-linux docker-build docker-up docker-stop

# Build the single deployable binary (frontend baked into the Rust server).
build: build-backend

# Only recompile contracts when .sol files change.
artifacts: contracts/*.sol
	npm i
	npx hardhat compile

build-frontend:
	cd app && pnpm install && pnpm build

build-backend: build-frontend artifacts
	cd rust-backend && cargo build --release

docker-build-linux:
	docker build --platform linux/amd64 -t fund-router .
	docker save fund-router | gzip > fund-router.tar.gz

docker-build:
	docker build -t fund-router .

docker-up:
	docker-compose up -d --build

docker-stop:
	docker-compose down --volumes --remove-orphans

clean:
	rm -rf artifacts/ cache/ typechain-types/ node_modules/
	rm -rf app/dist app/node_modules
	cd rust-backend && cargo clean
