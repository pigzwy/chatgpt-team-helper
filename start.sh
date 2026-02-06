#!/bin/bash

cd "$(dirname "$0")"

CONTAINER_NAME="auto-gpt-team"
IMAGE_NAME="auto-gpt-team:latest"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "🔄 容器正在运行，执行重启..."
    docker compose down
fi

if [[ "$1" == "--build" ]] || [[ "$1" == "-b" ]]; then
    echo "🔨 强制构建镜像..."
    docker build -t ${IMAGE_NAME} .
elif ! docker image inspect ${IMAGE_NAME} &>/dev/null; then
    echo "🔨 镜像不存在，首次构建..."
    docker build -t ${IMAGE_NAME} .
else
    echo "⏭️  镜像已存在，跳过构建（使用 -b 强制构建）"
fi

echo "🚀 启动容器..."
docker compose up -d

echo ""
echo "✅ 启动完成"
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "📍 本机访问: http://localhost:29527"
echo "📍 局域网访问: http://${LOCAL_IP}:29527"
echo "👤 账号: admin"
echo "🔑 密码: admin123456"
echo ""
echo "查看日志: docker compose logs -f app"
