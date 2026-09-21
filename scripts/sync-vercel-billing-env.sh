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

# pixel-edm 本地若已写 CREEM_EDM_TEAM_* / DODO_EDM_TEAM_*，优先推到 Vercel（避免只建了 key 无值）
LOCAL_ENV="$ROOT/.env.local"
if [[ -f "$LOCAL_ENV" ]]; then
  push_local_edm_team() {
    local name=$1
    local val
    val="$(grep -m1 "^${name}=" "$LOCAL_ENV" | cut -d= -f2- || true)"
    if [[ -z "${val}" ]]; then
      return
    fi
    for env in production preview; do
      printf '%s' "$val" | npx vercel env add "$name" "$env" --force --yes >/dev/null
    done
    echo "set ${name} (from pixel-edm .env.local)"
  }
  for key in CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID CREEM_EDM_TEAM_YEARLY_PRODUCT_ID \
    DODO_EDM_TEAM_MONTHLY_PRODUCT_ID DODO_EDM_TEAM_YEARLY_PRODUCT_ID; do
    push_local_edm_team "$key"
  done
fi

echo "完成。写入 Vercel 后需重新部署 Production/Preview 才会生效；见 docs/p11-team-billing-setup.md"
