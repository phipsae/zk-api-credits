#!/bin/bash
# update.sh — Pull latest code and redeploy the ZK API Credits server
# Run this on the AWS box: bash ~/zk-api-credits/update.sh

set -e

echo "🔄 Pulling latest code..."
cd ~/zk-api-credits
git pull

echo "🐳 Rebuilding Docker image (build context: repo root)..."
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

# Build from repo root so Dockerfile can access both api-server/ and circuits/
docker build -f packages/api-server/Dockerfile -t zk-api-server .

echo "🚀 Starting server..."
docker run -d -p 3001:3001 \
  --env-file packages/api-server/.env \
  -v $(pwd)/packages/api-server/data:/app/data \
  --restart unless-stopped \
  zk-api-server

echo "⏳ Waiting for server to start..."
sleep 5

echo "✅ Health check..."
curl -s https://backend.zkllmapi.com/health | python3 -m json.tool

echo ""
echo "✅ Circuit check..."
curl -s https://backend.zkllmapi.com/circuit | head -c 80
echo ""
echo ""
echo "🎉 Done!"
