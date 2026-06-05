import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'

interface ContractConfig {
  address: string
  startBlock: number
}

interface NetworkConfig {
  [contractName: string]: ContractConfig
}

interface NetworksConfig {
  [network: string]: NetworkConfig
}

// Template for the Spry data sources. Spry runs on the canonical, unmodified V4
// PoolManager + PositionManager; there are no extra (Euler/Arrakis/aggregator)
// data sources. Pools are filtered to the SpryHook inside the Initialize handler
// (see src/utils/spry.ts), so the hook itself is NOT a data source.
const contractTemplates = {
  PoolManager: {
    kind: 'ethereum/contract',
    mapping: {
      kind: 'ethereum/events',
      apiVersion: '0.0.7',
      language: 'wasm/assemblyscript',
      file: './src/mappings/poolManager.mapping.ts',
      entities: ['Pool', 'Token', 'Tier'],
      abis: [
        { name: 'ERC20', file: './abis/ERC20.json' },
        { name: 'ERC20SymbolBytes', file: './abis/ERC20SymbolBytes.json' },
        { name: 'ERC20NameBytes', file: './abis/ERC20NameBytes.json' },
        { name: 'PoolManager', file: './abis/PoolManager.json' },
      ],
      eventHandlers: [
        {
          event: 'Initialize(indexed bytes32,indexed address,indexed address,uint24,int24,address,uint160,int24)',
          handler: 'handleInitialize',
        },
        {
          event: 'ModifyLiquidity(indexed bytes32,indexed address,int24,int24,int256,bytes32)',
          handler: 'handleModifyLiquidity',
        },
        {
          event: 'Swap(indexed bytes32,indexed address,int128,int128,uint160,uint128,int24,uint24)',
          handler: 'handleSwap',
        },
        {
          event: 'Donate(indexed bytes32,indexed address,uint256,uint256)',
          handler: 'handleDonate',
        },
      ],
    },
  },
  PositionManager: {
    kind: 'ethereum/contract',
    mapping: {
      kind: 'ethereum/events',
      apiVersion: '0.0.7',
      language: 'wasm/assemblyscript',
      file: './src/mappings/positionManager.mapping.ts',
      entities: ['Position'],
      abis: [{ name: 'PositionManager', file: './abis/PositionManager.json' }],
      eventHandlers: [
        {
          event: 'Subscription(indexed uint256,indexed address)',
          handler: 'handleSubscription',
        },
        {
          event: 'Unsubscription(indexed uint256,indexed address)',
          handler: 'handleUnsubscription',
        },
        {
          event: 'Transfer(indexed address,indexed address,indexed uint256)',
          handler: 'handleTransfer',
        },
      ],
    },
  },
  // The SpryHook: emits SpryFee, the canonical Spry per-swap analytics source.
  // Its `address` in networks.json must equal SPRY_HOOK_ADDRESS in src/utils/spry.ts.
  SpryHook: {
    kind: 'ethereum/contract',
    mapping: {
      kind: 'ethereum/events',
      apiVersion: '0.0.7',
      language: 'wasm/assemblyscript',
      file: './src/mappings/spryHook.mapping.ts',
      entities: ['Pool', 'Tier', 'SpryFeeObservation', 'SpryFeeWindow', 'SpryFeePending'],
      abis: [{ name: 'SpryHook', file: './abis/SpryHook.json' }],
      eventHandlers: [
        {
          event: 'SpryFee(indexed bytes32,int256,int256,uint24,uint8,uint8,uint64)',
          handler: 'handleSpryFee',
        },
      ],
    },
  },
}

// Base subgraph configuration
const baseConfig = {
  specVersion: '0.0.4',
  description: 'Spry, Uniswap V4 + the SpryHook dynamic-fee hook. Indexes only Spry pools.',
  repository: 'https://github.com/spry-protocol/spry-subgraph',
  schema: {
    file: './schema.graphql',
  },
  features: ['nonFatalErrors', 'grafting'],
}

function generateSubgraphConfig(network: string, networkConfig: NetworkConfig): any {
  const config = { ...baseConfig }
  const dataSources: any[] = []

  // For each contract in the network
  Object.entries(networkConfig).forEach(([contractName, contractConfig]) => {
    if (contractTemplates[contractName]) {
      const dataSource = {
        source: {
          abi: contractName,
          address: contractConfig.address,
          startBlock: contractConfig.startBlock,
        },
        name: contractName,
        network,
        ...contractTemplates[contractName],
      }
      dataSources.push(dataSource)
    }
  })

  return {
    ...config,
    dataSources,
  }
}

function main() {
  try {
    // Get network from command line arguments
    const network = process.argv[2]
    if (!network) {
      console.error('Please provide a network name as an argument')
      console.error('Usage: yarn generate-subgraph <network>')
      process.exit(1)
    }

    // Read networks.json
    const networksConfigPath = path.join(__dirname, '..', 'networks.json')
    const networksConfig: NetworksConfig = JSON.parse(fs.readFileSync(networksConfigPath, 'utf8'))

    // Check if network exists
    if (!networksConfig[network]) {
      console.error(`Network "${network}" not found in networks.json`)
      console.error('Available networks:', Object.keys(networksConfig).join(', '))
      process.exit(1)
    }

    // Generate the subgraph configuration for the specific network
    const subgraphConfig = generateSubgraphConfig(network, networksConfig[network])

    // Convert to YAML
    const yamlContent = yaml.stringify(subgraphConfig)

    // Write to subgraph.yaml
    const subgraphYamlPath = path.join(__dirname, '..', 'subgraph.yaml')
    fs.writeFileSync(subgraphYamlPath, yamlContent, 'utf8')

    console.log(`Successfully generated subgraph.yaml for network: ${network}`)
  } catch (error) {
    console.error('Error generating subgraph.yaml:', error)
    process.exit(1)
  }
}

main()
