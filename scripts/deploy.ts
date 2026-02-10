import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // 1. Deploy FundRouterStorage
  const FundRouterStorage = await ethers.getContractFactory("FundRouterStorage");
  const storage = await FundRouterStorage.deploy(deployer.address);
  await storage.waitForDeployment();
  const storageAddress = await storage.getAddress();
  console.log("FundRouterStorage deployed to:", storageAddress);

  // 2. Deploy FundRouter
  const FundRouter = await ethers.getContractFactory("FundRouter");
  const router = await FundRouter.deploy(storageAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("FundRouter deployed to:", routerAddress);

  // 3. Deploy DeterministicProxyDeployer
  const DeterministicProxyDeployer = await ethers.getContractFactory("DeterministicProxyDeployer");
  const proxyDeployer = await DeterministicProxyDeployer.deploy(routerAddress);
  await proxyDeployer.waitForDeployment();
  const proxyDeployerAddress = await proxyDeployer.getAddress();
  console.log("DeterministicProxyDeployer deployed to:", proxyDeployerAddress);

  console.log("\nDeployment complete!");
  console.log("---");
  console.log("FundRouterStorage:", storageAddress);
  console.log("FundRouter:", routerAddress);
  console.log("DeterministicProxyDeployer:", proxyDeployerAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
