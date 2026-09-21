#!/usr/bin/env bash
# 从 content-up 本地 .env.local 同步账单相关变量到 pixel-edm Vercel（不打印密钥）。
set -euo pipefail

SOURCE="${1:-../content-up/.env.local}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$SOURCE" ]]; then
  echo "找不到 $SOURCE" >&2
  exit 1
fi

get_var() {
  grep -m1 "^${1}=" "$SOURCE" | cut -d= -f2-
}

add_env() {
  local name=$1
  local val
  val="$(get_var "$name" || true)"
  if [[ -z "${val}" ]]; then
    echo "skip ${name} (empty)"
    return
  fi
  for env in production preview; do
    printf '%s' "$val" | npx vercel env add "$name" "$env" --force --yes >/dev/null 2>&1
    echo "set ${name} (${env})"
  done
}

add_env SUPABASE_SERVICE_ROLE_KEY
add_env CREEM_API_KEY
add_env CREEM_WEBHOOK_SECRET
add_env DODO_PAYMENTS_API_KEY
add_env DODO_PAYMENTS_WEBHOOK_KEY
add_env DODO_PAYMENTS_ENVIRONMENT

# 若尚无 EDM 专用商品，可暂时复用主站 Pro 商品 ID（上线前请换成独立 EDM 商品）。
copy_env() {
  local dest=$1
  local src=$2
  local val
  val="$(get_var "$src" || true)"
  if [[ -z "${val}" ]]; then
    echo "skip ${dest} (source ${src} empty)"
    return
  fi
  for env in production preview; do
    printf '%s' "$val" | npx vercel env add "$dest" "$env" --force --yes >/dev/null
  done
  echo "set ${dest} (interim copy from ${src})"
}

copy_env CREEM_EDM_PRO_MONTHLY_PRODUCT_ID CREEM_PRO_MONTHLY_PRODUCT_ID
copy_env CREEM_EDM_PRO_YEARLY_PRODUCT_ID CREEM_PRO_YEARLY_PRODUCT_ID
copy_env DODO_EDM_PRO_MONTHLY_PRODUCT_ID DODO_PRO_MONTHLY_PRODUCT_ID
copy_env DODO_EDM_PRO_YEARLY_PRODUCT_ID DODO_PRO_YEARLY_PRODUCT_ID

# Team：优先从 content-up 的 CREEM_TEAM_* / DODO_TEAM_* 映射到 EDM 专用变量（若已创建 EDM Team 商品则改用独立 env 名）
copy_env CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID CREEM_TEAM_MONTHLY_PRODUCT_ID
copy_env CREEM_EDM_TEAM_YEARLY_PRODUCT_ID CREEM_TEAM_YEARLY_PRODUCT_ID
copy_env DODO_EDM_TEAM_MONTHLY_PRODUCT_ID DODO_TEAM_MONTHLY_PRODUCT_ID
copy_env DODO_EDM_TEAM_YEARLY_PRODUCT_ID DODO_TEAM_YEARLY_PRODUCT_ID

# Team 商品：按 Dashboard 名称解析（避免把 Dodo 测试 id 误推到 Production）
RESOLVE="$ROOT/scripts/resolve-edm-team-product-ids.mjs"
if [[ -f "$RESOLVE" ]] && [[ -d "$ROOT/../content-up/node_modules/creem" ]]; then
  push_team_file() {
    local target=$1
    local file
    file="$(mktemp)"
    if ! node "$RESOLVE" "$target" >"$file" 2>/dev/null; then
      rm -f "$file"
      echo "skip Team env ($target): resolve-edm-team-product-ids 失败"
      return
    fi
    while IFS='=' read -r name val; do
      [[ -z "$name" || -z "$val" ]] && continue
      printf '%s' "$val" | npx vercel env add "$name" "$target" --force --yes >/dev/null
      echo "set ${name} (${target}, resolved)"
    done <"$file"
    rm -f "$file"
  }
  push_team_file production
  push_team_file preview
fi

echo "完成。写入 Vercel 后需重新部署 Production/Preview 才会生效；见 docs/p11-team-billing-setup.md"
