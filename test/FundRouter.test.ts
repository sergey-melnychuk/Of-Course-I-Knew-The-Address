import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("FundRouterStorage", function () {
  async function deployStorage() {
    const [owner, caller, treasury, other] = await ethers.getSigners();
    const Storage = await ethers.getContractFactory("FundRouterStorage");
    const storage = await Storage.deploy(owner.address);
    return { storage, owner, caller, treasury, other };
  }

  it("sets owner on deploy", async function () {
    const { storage, owner } = await loadFixture(deployStorage);
    expect(await storage.owner()).to.equal(owner.address);
  });

  it("reverts on zero-address owner", async function () {
    const Storage = await ethers.getContractFactory("FundRouterStorage");
    await expect(Storage.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Storage, "ZeroAddress");
  });

  it("only owner can set permissions", async function () {
    const { storage, other } = await loadFixture(deployStorage);
    await expect(storage.connect(other).setPermissions(other.address, 0x01))
      .to.be.revertedWithCustomError(storage, "NotOwner");
  });

  it("permission bits work correctly", async function () {
    const { storage, caller, treasury } = await loadFixture(deployStorage);

    // No permissions by default
    expect(await storage.isAllowedCaller(caller.address)).to.be.false;
    expect(await storage.isAllowedTreasury(treasury.address)).to.be.false;

    // Set caller bit (0x01)
    await storage.setPermissions(caller.address, 0x01);
    expect(await storage.isAllowedCaller(caller.address)).to.be.true;
    expect(await storage.isAllowedTreasury(caller.address)).to.be.false;

    // Set treasury bit (0x02)
    await storage.setPermissions(treasury.address, 0x02);
    expect(await storage.isAllowedCaller(treasury.address)).to.be.false;
    expect(await storage.isAllowedTreasury(treasury.address)).to.be.true;

    // Set both bits (0x03)
    await storage.setPermissions(caller.address, 0x03);
    expect(await storage.isAllowedCaller(caller.address)).to.be.true;
    expect(await storage.isAllowedTreasury(caller.address)).to.be.true;
    expect(await storage.isAllowedCallerAndTreasury(caller.address, caller.address)).to.be.true;
  });

  it("transfers ownership", async function () {
    const { storage, owner, other } = await loadFixture(deployStorage);
    await storage.transferOwnership(other.address);
    expect(await storage.owner()).to.equal(other.address);

    // Old owner can no longer set permissions
    await expect(storage.connect(owner).setPermissions(owner.address, 0x01))
      .to.be.revertedWithCustomError(storage, "NotOwner");
  });
});

describe("FundRouter", function () {
  async function deployRouter() {
    const [owner, caller, treasury, other] = await ethers.getSigners();

    const Storage = await ethers.getContractFactory("FundRouterStorage");
    const storage = await Storage.deploy(owner.address);

    const Router = await ethers.getContractFactory("FundRouter");
    const router = await Router.deploy(await storage.getAddress());

    // Grant permissions: caller = 0x01, treasury = 0x02
    await storage.setPermissions(caller.address, 0x01);
    await storage.setPermissions(treasury.address, 0x02);

    return { storage, router, owner, caller, treasury, other };
  }

  it("reverts on zero-address storage", async function () {
    const Router = await ethers.getContractFactory("FundRouter");
    await expect(Router.deploy(ethers.ZeroAddress)).to.be.revertedWith("storage=0");
  });

  it("reverts when caller is not authorized", async function () {
    const { router, other, treasury } = await loadFixture(deployRouter);
    await expect(
      router.connect(other).transferFunds(0, [], [], treasury.address)
    ).to.be.revertedWithCustomError(router, "NotAuthorizedCaller");
  });

  it("reverts when treasury is not authorized", async function () {
    const { router, caller, other } = await loadFixture(deployRouter);
    await expect(
      router.connect(caller).transferFunds(0, [], [], other.address)
    ).to.be.revertedWithCustomError(router, "TreasuryNotAllowed");
  });

  it("reverts on zero treasury address", async function () {
    const { router, caller } = await loadFixture(deployRouter);
    await expect(
      router.connect(caller).transferFunds(0, [], [], ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(router, "ZeroTreasury");
  });

  it("reverts on mismatched token/amount lengths", async function () {
    const { router, caller, treasury } = await loadFixture(deployRouter);
    const token = ethers.Wallet.createRandom().address;
    await expect(
      router.connect(caller).transferFunds(0, [token], [], treasury.address)
    ).to.be.revertedWithCustomError(router, "LengthMismatch");
  });

  it("routes ETH from proxy to treasury", async function () {
    const { router, caller, treasury } = await loadFixture(deployRouter);
    const routerAddr = await router.getAddress();

    // Send ETH to the router (simulates ETH arriving at a proxy)
    await caller.sendTransaction({ to: routerAddr, value: ethers.parseEther("1.0") });
    expect(await ethers.provider.getBalance(routerAddr)).to.equal(ethers.parseEther("1.0"));

    const balBefore = await ethers.provider.getBalance(treasury.address);

    await router.connect(caller).transferFunds(
      ethers.parseEther("1.0"), [], [], treasury.address
    );

    const balAfter = await ethers.provider.getBalance(treasury.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("1.0"));
    expect(await ethers.provider.getBalance(routerAddr)).to.equal(0);
  });

  it("accepts plain ETH via receive()", async function () {
    const { router, caller } = await loadFixture(deployRouter);
    const routerAddr = await router.getAddress();
    await caller.sendTransaction({ to: routerAddr, value: ethers.parseEther("0.5") });
    expect(await ethers.provider.getBalance(routerAddr)).to.equal(ethers.parseEther("0.5"));
  });
});

describe("DeterministicProxyDeployer", function () {
  async function deployAll() {
    const [owner, caller, treasury] = await ethers.getSigners();

    const Storage = await ethers.getContractFactory("FundRouterStorage");
    const storage = await Storage.deploy(owner.address);

    const Router = await ethers.getContractFactory("FundRouter");
    const router = await Router.deploy(await storage.getAddress());

    const Deployer = await ethers.getContractFactory("DeterministicProxyDeployer");
    const deployer = await Deployer.deploy(await router.getAddress());

    // Permissions: caller can call, treasury can receive
    await storage.setPermissions(caller.address, 0x01);
    await storage.setPermissions(treasury.address, 0x02);

    return { storage, router, deployer, owner, caller, treasury };
  }

  it("reverts on zero-address router", async function () {
    const Deployer = await ethers.getContractFactory("DeterministicProxyDeployer");
    await expect(Deployer.deploy(ethers.ZeroAddress)).to.be.revertedWith("router=0");
  });

  it("predicted address matches deployed address", async function () {
    const { deployer, caller } = await loadFixture(deployAll);
    const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt-1"));

    const [predicted] = await deployer.connect(caller).calculateDestinationAddresses([salt]);
    const tx = await deployer.connect(caller).deployMultiple([salt]);
    const receipt = await tx.wait();

    // Predict again — should still match
    const [predicted2] = await deployer.connect(caller).calculateDestinationAddresses([salt]);
    expect(predicted).to.equal(predicted2);

    // Deployed proxy should have code
    const code = await ethers.provider.getCode(predicted);
    expect(code).to.not.equal("0x");
  });

  it("deploys multiple proxies at once", async function () {
    const { deployer, caller } = await loadFixture(deployAll);
    const salts = [
      ethers.keccak256(ethers.toUtf8Bytes("multi-1")),
      ethers.keccak256(ethers.toUtf8Bytes("multi-2")),
      ethers.keccak256(ethers.toUtf8Bytes("multi-3")),
    ];

    const predicted = await deployer.connect(caller).calculateDestinationAddresses(salts);
    await deployer.connect(caller).deployMultiple(salts);

    for (const addr of predicted) {
      const code = await ethers.provider.getCode(addr);
      expect(code).to.not.equal("0x");
    }
  });

  it("different callers get different addresses for the same salt", async function () {
    const { deployer, caller, treasury } = await loadFixture(deployAll);
    const salt = ethers.keccak256(ethers.toUtf8Bytes("same-salt"));

    const [addr1] = await deployer.connect(caller).calculateDestinationAddresses([salt]);
    const [addr2] = await deployer.connect(treasury).calculateDestinationAddresses([salt]);

    expect(addr1).to.not.equal(addr2);
  });

  it("reverts when deploying same salt twice", async function () {
    const { deployer, caller } = await loadFixture(deployAll);
    const salt = ethers.keccak256(ethers.toUtf8Bytes("duplicate"));

    await deployer.connect(caller).deployMultiple([salt]);
    await expect(deployer.connect(caller).deployMultiple([salt])).to.be.reverted;
  });

  it("end-to-end: deploy proxy, fund it, route to treasury", async function () {
    const { deployer, caller, treasury, storage } = await loadFixture(deployAll);
    const salt = ethers.keccak256(ethers.toUtf8Bytes("e2e-salt"));

    // 1. Predict and deploy proxy
    const [proxyAddr] = await deployer.connect(caller).calculateDestinationAddresses([salt]);
    await deployer.connect(caller).deployMultiple([salt]);

    // 2. Fund the proxy
    await caller.sendTransaction({ to: proxyAddr, value: ethers.parseEther("0.5") });
    expect(await ethers.provider.getBalance(proxyAddr)).to.equal(ethers.parseEther("0.5"));

    // 3. The proxy's caller is the deployer contract (delegatecall), but
    //    transferFunds is called via the proxy which delegatecalls to FundRouter.
    //    msg.sender in the delegatecall context is whoever calls the proxy.
    //    Grant caller permission.
    await storage.setPermissions(caller.address, 0x01);

    const balBefore = await ethers.provider.getBalance(treasury.address);

    // 4. Call transferFunds on the proxy (which delegatecalls to FundRouter)
    const routerAbi = (await ethers.getContractFactory("FundRouter")).interface;
    const proxyAsRouter = new ethers.Contract(proxyAddr, routerAbi, caller);

    await proxyAsRouter.transferFunds(
      ethers.parseEther("0.5"), [], [], treasury.address
    );

    // 5. Verify
    const balAfter = await ethers.provider.getBalance(treasury.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
    expect(await ethers.provider.getBalance(proxyAddr)).to.equal(0);
  });
});
