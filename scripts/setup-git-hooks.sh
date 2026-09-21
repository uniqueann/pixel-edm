#!/usr/bin/env sh
# 将本仓库 Git hooks 目录设为 .githooks（仅需每位开发者执行一次）。
set -e
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
echo "已设置 core.hooksPath=.githooks（pre-push → npm run ci:push）"
