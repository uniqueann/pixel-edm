# Impeccable skill（本仓库副本）

这是 [Impeccable](https://github.com/pbakaus/impeccable) 4.8.0 的项目级 skill，只放在 pixel-edm 的 `.cursor/skills/impeccable`。它不会安装到其他仓库，也不会变成所有云端环境的全局 skill。

## 版本

- Skill：`4.8.0`（`SKILL.md` 的 `metadata.version`）
- 引擎：`0.1.18`（`scripts/VERSION`，校验表 `scripts/engine-checksums.txt`）
- 附件 zip SHA256：`6cf678056be028ed49980e97ef87f00d56842b76b951ef9e33402e412b8b8a2b`（63 个文件）
- 与上游一致的提交：`7510e233b228864606888d252abacf5e7148bf87`（2026-10-28，「Sync generated provider output」）。该提交仍标记 4.8.0，位于 tag `skill-v4.8.0`（2026-10-26）和 `skill-v4.8.1`（2026-11-08）之间。除 `scripts/impeccable.cmd` 的换行外，63 个文件与该提交的 `.agents/skills/impeccable` git blob 一致。`.cmd` 正文相同；本分发按上游 `.gitattributes`（`*.cmd text eol=crlf`）使用 CRLF，git 对象里存的是 LF。

## 安装与调用

在本仓库根目录工作。Cursor 读取 `.cursor/skills/impeccable/SKILL.md` 后按其中的命令执行。可执行入口是启动器，不是 Node 脚本：

```sh
.cursor/skills/impeccable/scripts/impeccable <verb>
```

没有 `sh` 的 Windows 命令行改用：

```bat
.cursor/skills/impeccable/scripts/impeccable.cmd <verb>
```

Codex 原文里的 `$impeccable <verb>` 是该环境的命令写法，不是 shell 变量。这里不要把它展开，也不要改成某台机器的绝对路径。首次设计任务先跑一次 `context`，工作目录保持在仓库根。

## 路径

`SKILL.md` 规定 `<skill-base-dir>` 是包含 `SKILL.md` 的目录，用来解析文中的脚本命令；只有运行时没有报告该目录时，才回退到写死的示例路径。Codex 分发的示例和回退路径是 `.agents/skills/impeccable`。本仓库的实际目录是 `.cursor/skills/impeccable`，因此 18 个含该前缀的文本文件只做了这一处替换，并在文件内加了一行适配说明。`scripts/impeccable` 用自身所在目录的上一级作为 `IMPECCABLE_SKILL_DIR`，不写死 harness 路径，字节未改。

## 依赖

- 不加入本仓库的 `package.json`，启动器也不需要 Node。
- 顺序：`$IMPECCABLE_BIN`、旁边的 `scripts/bin/<os>-<arch>/impeccable`、`~/.impeccable` 里已校验的缓存，然后是 `PATH` 上的引擎。都没有时，从 `https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.18/` 下载对应平台文件，并用同目录 `engine-checksums.txt` 校验后写入用户缓存（可用 `IMPECCABLE_HOME` 改位置）。需要 `curl` 或 `wget`，以及 `sha256sum` 或 `shasum`。
- 本副本不包含引擎二进制，也不把缓存写进仓库。
- `live` 需要本地开发服务器和浏览器，不属于本仓库的构建或测试。

## 许可证

Codex zip 里没有 LICENSE / NOTICE。Apache-2.0 再分发需要附上许可证，并保留 NOTICE 中的署名，因此从上述同一提交原样放入：

- `LICENSE`：Apache License 2.0。该提交的 `package.json` 也声明 `license: Apache-2.0`，作者 Paul Bakaus。
- `NOTICE.md`：`reference/ios.md` 与 `reference/android.md` 改写自 [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)（MIT，作者 ehmo）。

`scripts/data/font-index.json` 是上游在发布时根据 Google Fonts 目录生成的指纹数据，随 skill 分发，不是字体文件。`scripts/modern-screenshot.umd.js` 在这份分发和上游 NOTICE 里都没有单独的许可证头；本次不另写来源声明。

仓库的 `.prettierignore` 排除了本目录，这样 `format:check` 不会重排上游脚本和 JSON。ESLint 对其中两个既有脚本只有警告，本次没有为了消警告去改它们。
