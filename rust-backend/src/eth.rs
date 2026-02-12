use alloy::{
    network::EthereumWallet,
    primitives::{Address, FixedBytes, U256},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
};

/// Fetch ETH balance in wei for an address; returns 32-byte big-endian.
pub async fn get_balance(rpc_url: &str, address: Address) -> anyhow::Result<[u8; 32]> {
    let provider = ProviderBuilder::new().connect_http(rpc_url.parse()?);
    let balance: U256 = provider.get_balance(address).await?;
    Ok(balance.to_be_bytes())
}

sol! {
    #[sol(rpc)]
    interface IDeterministicProxyDeployer {
        function calculateDestinationAddresses(
            bytes32[] calldata salts
        ) external view returns (address[] memory);

        function deployMultiple(
            bytes32[] calldata salts
        ) external returns (address[] memory);
    }
}

sol! {
    #[sol(rpc)]
    interface IFundRouter {
        function transferFunds(
            uint256 etherAmount,
            address[] calldata tokens,
            uint256[] calldata amounts,
            address payable treasuryAddress
        ) external;
    }
}

/// Predict proxy addresses for the given salts via `calculateDestinationAddresses`,
/// as if `caller` were the msg.sender.
pub async fn predict_proxy_addresses(
    rpc_url: &str,
    deployer_address: Address,
    caller: Address,
    salts: Vec<FixedBytes<32>>,
) -> anyhow::Result<Vec<Address>> {
    let provider = ProviderBuilder::new().connect_http(rpc_url.parse()?);
    let deployer = IDeterministicProxyDeployer::new(deployer_address, &provider);

    let addrs = deployer
        .calculateDestinationAddresses(salts)
        .from(caller)
        .call()
        .await?;

    Ok(addrs)
}

/// Deploy proxies on-chain via `deployMultiple(salts)`, signing with the
/// given private key, and return the deployed addresses.
pub async fn deploy_proxies(
    rpc_url: &str,
    deployer_address: Address,
    private_key: &str,
    salts: Vec<FixedBytes<32>>,
) -> anyhow::Result<Vec<Address>> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let wallet = EthereumWallet::from(signer);

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect_http(rpc_url.parse()?);

    let deployer = IDeterministicProxyDeployer::new(deployer_address, &provider);

    let predicted = deployer
        .calculateDestinationAddresses(salts.clone())
        .call()
        .await?;

    let mut non_proxies = Vec::new();
    for (address, salt) in predicted.into_iter().zip(salts.into_iter()) {
        let code = provider.get_code_at(address).await?;
        if code.is_empty() {
            non_proxies.push(salt);
        }
    }

    let call = deployer.deployMultiple(non_proxies);

    // Simulate to get all deployed addresses.
    let addrs = call.call().await?;

    // Send the real transaction.
    let receipt = call.send().await?.get_receipt().await?;

    if !receipt.status() {
        anyhow::bail!("deploy tx reverted: {:?}", receipt.transaction_hash);
    }

    Ok(addrs)
}

/// Call transferFunds on proxy and return the transaction hash.
pub async fn route_funds(
    rpc_url: &str,
    private_key: &str,
    proxy: Address,
    treasury: Address,
) -> anyhow::Result<FixedBytes<32>> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let wallet = EthereumWallet::from(signer);

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect_http(rpc_url.parse()?);

    let contract = IFundRouter::new(proxy, &provider);

    let amount = provider.get_balance(proxy).await?;
    tracing::info!(proxy=?proxy, amount=?amount, "routing funds");
    if amount.is_zero() {
        return Ok(FixedBytes::ZERO);
    }

    let receipt = contract
        .transferFunds(amount, vec![], vec![], treasury)
        .send()
        .await?
        .get_receipt()
        .await?;

    if !receipt.status() {
        anyhow::bail!(
            "transferFunds reverted on proxy {proxy}: tx {:?}",
            receipt.transaction_hash
        );
    }

    Ok(receipt.transaction_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::keccak256;

    sol!(
        #[sol(rpc)]
        FundRouterStorage,
        "../artifacts/contracts/FundRouterStorage.sol/FundRouterStorage.json"
    );

    sol!(
        #[sol(rpc)]
        FundRouter,
        "../artifacts/contracts/FundRouter.sol/FundRouter.json"
    );

    sol!(
        #[sol(rpc)]
        DeterministicProxyDeployer,
        "../artifacts/contracts/DeterministicProxyDeployer.sol/DeterministicProxyDeployer.json"
    );

    /// Deploy: FundRouterStorage -> FundRouter -> DeterministicProxyDeployer
    /// Then deploy a proxy and verify its address matches the prediction.
    ///
    /// Run with: cargo test deploy_all -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "Requires a funded PRIVATE_KEY and SEPOLIA_RPC_URL in .env"]
    async fn deploy_all() {
        dotenv::dotenv().ok();

        let rpc_url = std::env::var("SEPOLIA_RPC_URL").expect("SEPOLIA_RPC_URL");
        let private_key = std::env::var("PRIVATE_KEY").expect("PRIVATE_KEY");

        let signer: PrivateKeySigner = private_key.parse().expect("bad PRIVATE_KEY");
        let caller = signer.address();
        let wallet = EthereumWallet::from(signer);
        println!("caller: {caller}");

        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(rpc_url.parse().unwrap());

        // 1. Deploy FundRouterStorage(owner = caller)
        println!("\n--- deploying FundRouterStorage ---");
        let storage = FundRouterStorage::deploy(&provider, caller)
            .await
            .expect("FundRouterStorage deploy failed");
        let storage_addr = *storage.address();
        println!("FundRouterStorage: {storage_addr}");

        // 2. Grant caller permission bits: 0x03 = caller + treasury
        println!("setting permissions for caller...");
        let receipt = storage
            .setPermissions(caller, 0x03)
            .send()
            .await
            .expect("setPermissions send failed")
            .get_receipt()
            .await
            .expect("setPermissions receipt failed");
        assert!(receipt.status(), "setPermissions reverted");
        println!("permissions set");

        // 3. Deploy FundRouter(storageAddress)
        println!("\n--- deploying FundRouter ---");
        let router = FundRouter::deploy(&provider, storage_addr)
            .await
            .expect("FundRouter deploy failed");
        let router_addr = *router.address();
        println!("FundRouter: {router_addr}");

        // 4. Deploy DeterministicProxyDeployer(fundRouter)
        println!("\n--- deploying DeterministicProxyDeployer ---");
        let deployer = DeterministicProxyDeployer::deploy(&provider, router_addr)
            .await
            .expect("DeterministicProxyDeployer deploy failed");
        let deployer_addr = *deployer.address();
        println!("DeterministicProxyDeployer: {deployer_addr}");

        // Verify immutable
        let got_router = deployer
            .FUND_ROUTER_ADDRESS()
            .call()
            .await
            .expect("FUND_ROUTER_ADDRESS call failed");
        assert_eq!(got_router, router_addr);

        // 5. Predict a proxy address
        let salt: FixedBytes<32> = keccak256(b"integration-test-salt-1");
        println!("\n--- proxy deploy (salt: {salt}) ---");

        let predicted = deployer
            .calculateDestinationAddresses(vec![salt])
            .call()
            .await
            .expect("predict call failed");
        assert_eq!(predicted.len(), 1);
        println!("predicted: {:?}", predicted[0]);

        // 6. Deploy the proxy
        let deploy_call = deployer.deployMultiple(vec![salt]);
        let simulated = deploy_call.call().await.expect("simulate failed");
        let receipt = deploy_call
            .send()
            .await
            .expect("deploy send failed")
            .get_receipt()
            .await
            .expect("deploy receipt failed");
        assert!(receipt.status(), "deployMultiple reverted");
        assert_eq!(simulated.len(), 1);
        println!("deployed:  {:?}", simulated[0]);

        assert_eq!(predicted[0], simulated[0], "predicted != deployed");
        println!("\nall addresses match. deployer contract: {deployer_addr}");
    }

    /// Revoke an EIP-7702 delegation by sending a type-4 transaction that
    /// delegates to address(0).
    ///
    /// PRIVATE_KEY  — the account whose delegation is being revoked (signs the authorization).
    /// SENDER_PRIVATE_KEY — a funded account that pays for gas and submits the tx.
    ///                      Falls back to PRIVATE_KEY if not set.
    ///
    /// Run with: cargo test revoke_eip7702 -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "Sends a real tx to Sepolia"]
    async fn revoke_eip7702() {
        use alloy::{
            eips::eip7702::Authorization,
            network::{TransactionBuilder, TransactionBuilder7702},
            primitives::U256,
            providers::Provider,
            rpc::types::TransactionRequest,
            signers::SignerSync,
        };

        dotenv::dotenv().ok();

        let rpc_url = std::env::var("SEPOLIA_RPC_URL").expect("SEPOLIA_RPC_URL");
        let private_key = "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";

        // The account whose delegation we want to revoke.
        let authority: PrivateKeySigner = private_key.parse().expect("bad PRIVATE_KEY");
        let account = authority.address();
        println!("account (delegation to revoke): {account}");

        // Funded sender from mnemonic (pays gas on behalf of the account).
        use alloy::signers::local::{MnemonicBuilder, coins_bip39::English};
        let phrase = "kick sail purity east trade tomato climb raw latin pioneer surround cargo";
        let sender = MnemonicBuilder::<English>::default()
            .phrase(phrase)
            .index(0)
            .unwrap()
            .build()
            .expect("bad mnemonic");
        println!("sender  (pays gas):             {}", sender.address());
        println!("sender private key:             {}", sender.to_bytes());
        let wallet = EthereumWallet::from(sender);

        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(rpc_url.parse().unwrap());

        let nonce = provider
            .get_transaction_count(account)
            .await
            .expect("get_transaction_count failed");
        println!("account nonce: {nonce}");

        // Authorization that delegates to address(0) = revoke.
        let auth = Authorization {
            chain_id: U256::from(11155111u64), // Sepolia
            address: Address::ZERO,
            nonce,
        };

        // The *authority* (account owner) signs the authorization.
        let sig = authority
            .sign_hash_sync(&auth.signature_hash())
            .expect("sign failed");
        let signed_auth = auth.into_signed(sig);

        // The *sender* submits the type-4 tx (to the account being cleared).
        let tx = TransactionRequest::default()
            .with_to(account)
            .with_authorization_list(vec![signed_auth]);

        let pending = provider
            .send_transaction(tx)
            .await
            .expect("send_transaction failed");
        println!("tx hash: {}", pending.tx_hash());

        let receipt = pending.get_receipt().await.expect("get_receipt failed");
        println!(
            "included in block {}",
            receipt.block_number.expect("no block number")
        );
        assert!(receipt.status(), "revocation tx reverted");
        println!("EIP-7702 delegation revoked for {account}");
    }
}
