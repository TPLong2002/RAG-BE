#!/bin/bash

set -e

IMAGE="tplong/be-chatbot"
TAG="${1:-latest}"

echo "Creating buildx builder (if needed)..."
docker buildx inspect multiarch-builder >/dev/null 2>&1 || \
docker buildx create --name multiarch-builder --use

docker buildx use multiarch-builder
docker buildx inspect --bootstrap

echo "Building and pushing ${IMAGE}:${TAG}..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ${IMAGE}:${TAG} \
  -f ./Dockerfile \
  . \
  --push

echo "Done!"
