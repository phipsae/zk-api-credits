#!/bin/bash
# update.sh — Pull latest code and redeploy the ZK API Credits server
# Run this on the AWS box: bash update.sh

set -e

echo "🔄 Pulling latest code..."
cd ~/zk-api-credits
git pull

echo "🐳 Rebuilding Docker image..."
cd packages/api-server
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true
docker build -t zk-api-server .

echo "🚀 Starting server..."
docker run -d -p 3001:3001 \
  --env-file .env \
  -v $(pwd)/data:/app/data \
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
