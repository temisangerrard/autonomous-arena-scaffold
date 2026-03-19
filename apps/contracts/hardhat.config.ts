import 'dotenv/config';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || '';
const baseRpcUrl = process.env.BASE_RPC_URL || process.env.CHAIN_RPC_URL || '';
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.ESCROW_RESOLVER_PRIVATE_KEY || '';
const basescanApiKey = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || '';

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
    },
    base: {
      url: baseRpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : []
    }
  },
  etherscan: {
    apiKey: {
      sepolia: basescanApiKey,
      base: basescanApiKey
    },
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org'
        }
      },
      {
        network: 'sepolia',
        chainId: 11155111,
        urls: {
          apiURL: 'https://api-sepolia.etherscan.io/api',
          browserURL: 'https://sepolia.etherscan.io'
        }
      }
    ]
  }
};

export default config;
