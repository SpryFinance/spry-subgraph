#!/usr/bin/env bash
#
# Deploy the Spry subgraph to Goldsky (https://goldsky.com).
#
# Goldsky hosts standard graph-cli subgraphs, so this is the SAME subgraph and
# codebase as the Graph / Alchemy deploy: only the deploy target differs.
#
# One-time setup:
#   1. Install the Goldsky CLI:   curl https://goldsky.com | sh
#      (see https://docs.goldsky.com for alternatives)
#   2. Create an API key in the Goldsky dashboard, then log in:   goldsky login
#
# Usage:
#   ./scripts/deploy-goldsky.sh [version] [network]
#     version   subgraph version tag   (default: "version" from package.json)
#     network   a key in networks.json  (optional; if given, the manifest is
#               regenerated for that network before deploying)
#
# Examples:
#   ./scripts/deploy-goldsky.sh                      # deploy current manifest, pkg version
#   ./scripts/deploy-goldsky.sh 1.0.0                # explicit version
#   ./scripts/deploy-goldsky.sh 1.0.0 base-sepolia   # retarget base-sepolia, then deploy
#
# Or via yarn:   yarn deploy:goldsky 1.0.0 base-sepolia
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="$(node -p "require('./package.json').name")"
VERSION="${1:-$(node -p "require('./package.json').version")}"
NETWORK="${2:-}"

if ! command -v goldsky >/dev/null 2>&1; then
  echo "Error: the 'goldsky' CLI is not installed." >&2
  echo "  Install:  curl https://goldsky.com | sh" >&2
  echo "  Login:    goldsky login   (needs an API key from the Goldsky dashboard)" >&2
  exit 1
fi

# Goldsky subgraph name: suffix the network so each chain is its own deployment
# (e.g. spry-subgraph-unichain-sepolia, spry-subgraph-base-sepolia) and per-chain
# deployments do not overwrite one another. The no-network default stays bare.
DEPLOY_NAME="$NAME"
if [ -n "$NETWORK" ]; then
  DEPLOY_NAME="$NAME-$NETWORK"
fi

if [ -n "$NETWORK" ]; then
  echo "==> Regenerating subgraph.yaml for network: $NETWORK"
  yarn generate-subgraph "$NETWORK"
fi

echo "==> codegen + build"
yarn run codegen
yarn run buildonly

echo "==> Deploying to Goldsky as: $DEPLOY_NAME/$VERSION"
goldsky subgraph deploy "$DEPLOY_NAME/$VERSION" --path .

echo ""
echo "Deployed. Get the query URL and manage tags at https://app.goldsky.com"
