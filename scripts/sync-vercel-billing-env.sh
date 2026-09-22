#!/usr/bin/env bash
# 按支付环境同步 EDM 商品 ID；保留各项目独立的支付密钥和 Webhook 密钥。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${1:-$ROOT/../content-up/.env.local}"
DODO_LIVE_SOURCE="$ROOT/../content-up/.env.dodo-live.local"
RESOLVE="$ROOT/scripts/resolve-edm-team-product-ids.mjs"
cd "$ROOT"

for file in "$SOURCE" "$DODO_LIVE_SOURCE" "$RESOLVE"; do
  if [[ ! -f "$file" ]]; then
    echo "找不到 $file" >&2
    exit 1
  fi
done
if [[ ! -d "$ROOT/../content-up/node_modules/creem" ]]; then
  echo "content-up 尚未安装 creem 依赖" >&2
  exit 1
fi

get_var() {
  local name=$1
  local file=$2
  grep -m1 "^${name}=" "$file" | cut -d= -f2-
}

set_env() {
  local dest=$1
  local target=$2
  local source_file=$3
  local source_name=${4:-$dest}
  local value
  value="$(get_var "$source_name" "$source_file" || true)"
  if [[ -z "$value" ]]; then
    echo "缺少 ${source_file} 中的 ${source_name}" >&2
    return 1
  fi
  printf '%s' "$value" | npx vercel env add "$dest" "$target" --force --yes --sensitive >/dev/null
  echo "set ${dest} (${target})"
}

# 先解析两套商品，解析失败时不改动 Vercel。
production_products="$(mktemp)"
preview_products="$(mktemp)"
trap 'rm -f "$production_products" "$preview_products"' EXIT
node "$RESOLVE" production >"$production_products"
node "$RESOLVE" preview >"$preview_products"

for target in production preview; do
  if [[ "$target" == production ]]; then
    dodo_source="$DODO_LIVE_SOURCE"
    products_file="$production_products"
  else
    dodo_source="$SOURCE"
    products_file="$preview_products"
  fi
  set_env DODO_EDM_PRO_MONTHLY_PRODUCT_ID "$target" "$dodo_source" DODO_PRO_MONTHLY_PRODUCT_ID
  set_env DODO_EDM_PRO_YEARLY_PRODUCT_ID "$target" "$dodo_source" DODO_PRO_YEARLY_PRODUCT_ID
  while IFS='=' read -r name value; do
    [[ -z "$name" || -z "$value" ]] && continue
    printf '%s' "$value" | npx vercel env add "$name" "$target" --force --yes --sensitive >/dev/null
    echo "set ${name} (${target}, resolved)"
  done <"$products_file"
done

echo "完成。写入 Vercel 后需重新部署 Production/Preview 才会生效；见 docs/p11-team-billing-setup.md"
