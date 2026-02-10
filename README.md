# Of Course I Knew The Address

### Setup & Run

```
git clone https://github.com/sergey-melnychuk/Of-Course-I-Knew-The-Address.git
cd Of-Course-I-Knew-The-Address

nvm use 24

npm i
npx hardhat compile

cd rust-backend

cp .env.public .env
## Provide private key with enough SepoliaETH (even 0.1 should do)
## Provide treasury address you control (funds will be routed there)
## Deployer address is live on Sepolia (you can override if you want)

cargo run --release
<snip>
listening addr=127.0.0.1:3001

curl http://localhost:3001/deposits \
  -H "Content-Type: application/json" \
  -d '{"user":"0xd8da6bf26964af9d7eed9e03e53415d37aa96045"}'

curl "http://localhost:3001/deposits?status=pending" | jq
[
  {
    "id": 1,
    "user": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    "salt": "0x06e120c2c3547c60ee47f712d32e5acf38b35d1cc62e23b055a69bb88284c281",
    "address": "0x05ccce86da99591c4ce341997417adad83b65c08",
    "status": "pending",
    "created_at": "2026-02-10T17:43:08.742Z",
    "updated_at": "2026-02-10T17:43:08.742Z"
  }
]

## Now send some testETH to 0x05ccce86da99591c4ce341997417adad83b65c08
## Then wait until balance can clearly be seen in etherscan.io or RPC.

curl -X POST http://localhost:3001/route
{"counts":{"pending":1},"routed":1,"txs":["0xf4ca415a47f5500d6f6e1ebd7bb9cd4ae2d04a1e499d92173085fbc2857685da"]}

## The funds have been routed.
```

### Sample deployments on Sepolia

```
$ cargo test deploy_all -- --ignored --nocapture

caller: 0xc00c190D2d0B493B6817e6534F0A8Df65d84015b

--- deploying FundRouterStorage ---
FundRouterStorage: 0x67979DE8C2F18FcC405415432000f7231AA8F12C
setting permissions for caller...
permissions set

--- deploying FundRouter ---
FundRouter: 0xD0d0F17Db168A74d6cb924F40cF062Fa40C857da

--- deploying DeterministicProxyDeployer ---
DeterministicProxyDeployer: 0x576a15Ff748b6F9BE74E7666E1A7c717AF096e5E

--- proxy deploy (salt: 0x82aaa074595b6e878cad7c01a6c030083cfa85a1ab759f77f5748208f28869de) ---
predicted: 0xe24d719914b9e6bcfc95afe7ad8fd11ccbe6a101
deployed:  0xe24d719914b9e6bcfc95afe7ad8fd11ccbe6a101

all addresses match. deployer contract: 0x576a15Ff748b6F9BE74E7666E1A7c717AF096e5E
test eth::tests::deploy_all ... ok
```

```
$ cargo test deploy_all -- --ignored --nocapture

caller: 0xc00c190D2d0B493B6817e6534F0A8Df65d84015b

--- deploying FundRouterStorage ---
FundRouterStorage: 0x7A7fA1F129377d5DCF2BbE67B6efe17C1478675B
setting permissions for caller...
permissions set

--- deploying FundRouter ---
FundRouter: 0x2a6527A80cA2063C49B297aaf6F7Fd719ce8A17e

--- deploying DeterministicProxyDeployer ---
DeterministicProxyDeployer: 0x9957cCe0B4Bb631015e0AaBE13979b6f76110265

--- proxy deploy (salt: 0x82aaa074595b6e878cad7c01a6c030083cfa85a1ab759f77f5748208f28869de) ---
predicted: 0x3f96d72c589994b3173ba18433a31bfbd9457c5d
deployed:  0x3f96d72c589994b3173ba18433a31bfbd9457c5d

all addresses match. deployer contract: 0x9957cCe0B4Bb631015e0AaBE13979b6f76110265
test eth::tests::deploy_all ... ok
```
