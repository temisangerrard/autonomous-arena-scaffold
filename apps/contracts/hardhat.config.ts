import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || process.env.CHAIN_RPC_URL || '';
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.ESCROW_RESOLVER_PRIVATE_KEY || '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  },
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : []
    }
  }
};

export default config;
