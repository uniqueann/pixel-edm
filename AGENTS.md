项目约束：始终使用中文解释和代码注释。Supabase 复用 content-up，业务只操作 edm 和 edm_private；不得改写 aigc、共享 Auth 触发器或其他项目迁移历史。共享配置变更先核对兼容性。

## 推送与 CI（工程验证）

GitHub Actions 工作流 **「工程验证」**（`.github/workflows/ci.yml`）在 PR 上顺序执行：

`lint` → `typecheck` → `format:check` → `test` → `build` → `test:e2e`

仅跑 `npm test` **不能**代表会通过 CI。Vercel 预览绿 ≠ GitHub check 绿。

### 命令

| 命令 | 用途 |
|------|------|
| `npm run ci:push` | 与 CI 相同，**不含** E2E（push 前默认门槛，约 1～2 分钟） |
| `npm run ci:verify` | **完整** CI，含 Playwright（提 PR / 更新 PR 前必跑） |
| `npm run format` | 改代码后写入 Prettier；CI 用的是 `format:check` |

### Git pre-push（本地）

克隆或首次协作后执行一次：

```sh
npm run setup:hooks
```

之后每次 `git push` 会自动跑 `npm run ci:push`。紧急跳过：`SKIP_GIT_HOOKS=1 git push`（勿常态化）。

### Agent / Cloud 约定

- **每次 push 前**：至少 `npm run ci:push`；若失败则修复后再 push，不要只依赖云端 CI 试错的。
- **每次创建或更新 PR 前**：必须 `npm run ci:verify`（E2E 常因导航、套餐门控、`tests/auth-fixture.mjs` 未注册新 RPC 而失败）。
- 改动涉及 **设置页 / 导航 / 套餐 / 新 `edm.*` RPC** 时，同步检查 E2E 种子与 `tests/e2e/*.spec.ts`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
