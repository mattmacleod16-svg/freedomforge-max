/**
 * $FORGE Token Deployment Script
 * ═══════════════════════════════
 *
 * Usage:
 *   DEPLOY_NETWORK=sepolia WALLET_PRIVATE_KEY=0x... npx ts-node contracts/deploy.ts
 *
 * Supported networks:
 *   - sepolia (Ethereum testnet)
 *   - base-sepolia (Base testnet)
 *   - ethereum (mainnet — requires confirmation)
 *   - base (Base mainnet)
 *
 * Prerequisites:
 *   - WALLET_PRIVATE_KEY set in env
 *   - ALCHEMY_API_KEY set in env
 *   - Sufficient ETH for gas
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// ─── Network Configuration ───────────────────────────────────────────────────

const NETWORKS: Record<string, { rpc: string; chainId: number; explorer: string }> = {
  sepolia: {
    rpc: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    chainId: 11155111,
    explorer: 'https://sepolia.etherscan.io',
  },
  'base-sepolia': {
    rpc: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    chainId: 84532,
    explorer: 'https://sepolia.basescan.org',
  },
  ethereum: {
    rpc: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    chainId: 1,
    explorer: 'https://etherscan.io',
  },
  base: {
    rpc: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    chainId: 8453,
    explorer: 'https://basescan.org',
  },
};

// ─── Minimal ABI for deployment (compiled externally) ─────────────────────────

// The contract must be compiled with solc 0.8.20+ first.
// Use: solc --optimize --bin --abi contracts/FreedomForgeToken.sol -o contracts/build/
// This script reads the compiled bytecode from contracts/build/

async function main() {
  const network = process.env.DEPLOY_NETWORK || 'sepolia';
  const privateKey = process.env.WALLET_PRIVATE_KEY;

  if (!privateKey) {
    console.error('ERROR: WALLET_PRIVATE_KEY not set');
    process.exit(1);
  }

  const config = NETWORKS[network];
  if (!config) {
    console.error(`ERROR: Unknown network "${network}". Available: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }

  // Safety check for mainnet
  if (network === 'ethereum' || network === 'base') {
    console.warn(`\n⚠️  MAINNET DEPLOYMENT: ${network}`);
    console.warn('This will cost real ETH. Press Ctrl+C within 10 seconds to cancel.\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  console.log(`\n═══ $FORGE Token Deployment ═══`);
  console.log(`Network: ${network} (chain ${config.chainId})`);
  console.log(`Explorer: ${config.explorer}`);

  // Connect
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const treasury = wallet.address;

  console.log(`Treasury: ${treasury}`);

  const balance = await provider.getBalance(treasury);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === BigInt(0)) {
    console.error('ERROR: Wallet has no ETH for gas');
    process.exit(1);
  }

  // Check for compiled bytecode
  const buildDir = path.join(__dirname, 'build');
  const binPath = path.join(buildDir, 'FreedomForgeToken.bin');
  const abiPath = path.join(buildDir, 'FreedomForgeToken.abi');

  if (!fs.existsSync(binPath) || !fs.existsSync(abiPath)) {
    console.error('\nERROR: Compiled contract not found.');
    console.error('Run: solc --optimize --bin --abi contracts/FreedomForgeToken.sol -o contracts/build/');
    console.error('Or install solc: npm install -g solc');
    process.exit(1);
  }

  const bytecode = '0x' + fs.readFileSync(binPath, 'utf8').trim();
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

  // Deploy
  console.log('\nDeploying FreedomForgeToken...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  const gasPrice = (await provider.getFeeData()).gasPrice;
  console.log(`Gas price: ${ethers.formatUnits(gasPrice || BigInt(0), 'gwei')} gwei`);

  // Estimate gas before committing
  let gasEstimate = BigInt(600_000); // conservative fallback
  try {
    const deployTx = await factory.getDeployTransaction(treasury);
    gasEstimate = await provider.estimateGas(deployTx);
  } catch {
    console.warn('⚠️  Gas estimation failed — using fallback of 600,000 units');
  }
  const gasCostWei = gasEstimate * (gasPrice || BigInt(1_500_000_000));
  console.log(`Gas estimate: ${gasEstimate.toString()} units (~${ethers.formatEther(gasCostWei)} ETH)`);

  if (balance < gasCostWei) {
    console.error(`ERROR: Insufficient ETH for gas. Need ~${ethers.formatEther(gasCostWei)} ETH, wallet has ${ethers.formatEther(balance)} ETH`);
    process.exit(1);
  }

  const contract = await factory.deploy(treasury);
  console.log(`TX submitted: ${contract.deploymentTransaction()?.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✅ $FORGE deployed at: ${address}`);
  console.log(`Explorer: ${config.explorer}/address/${address}`);

  // Save deployment info
  const deploymentInfo = {
    network,
    chainId: config.chainId,
    address,
    treasury,
    txHash: contract.deploymentTransaction()?.hash,
    deployedAt: new Date().toISOString(),
    explorer: `${config.explorer}/address/${address}`,
    totalSupply: '1000000000000000000000000000', // 1B with 18 decimals
    symbol: 'FORGE',
  };

  const deploymentsDir = path.join(__dirname, 'deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const deployFile = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deployFile, JSON.stringify(deploymentInfo, null, 2), 'utf8');
  console.log(`\nDeployment saved: ${deployFile}`);

  // Post-deployment instructions
  console.log('\n═══ Next Steps ═══');
  console.log(`1. Set env var:  FORGE_TOKEN_ADDRESS=${address}`);
  console.log(`2. Set env var:  PAYOUT_TOKEN_ADDRESS=${address}  (to route token distributions to $FORGE)`);
  console.log(`3. Append to TRACKED_TOKENS: add ${address} (comma-separated, no spaces)`);
  console.log(`4. Verify contract source on explorer:`);
  console.log(`      ${config.explorer}/address/${address}#code`);
  console.log(`   Verification command (requires hardhat/foundry or etherscan CLI):`);
  console.log(`      npx hardhat verify --network ${network} ${address} "${treasury}"`);
  console.log(`5. Create liquidity pool on a DEX (Uniswap v3 / Aerodrome on Base)`);
  console.log(`6. Configure staking rewards emission via owner() wallet`);
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
