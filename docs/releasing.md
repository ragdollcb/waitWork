# Wait Work 发布打包

插件 ID：`monstercat.waitwork`，发布者：`monstercat`。源码仓库：<https://github.com/ragdollcb/waitWork>。

## 支持的平台

工作流 `.github/workflows/plugin-release.yml` 在各平台原生构建，使用锁定的 npm 依赖、Node.js 24 和 Go 1.26.5。关闭 CGO，Go 后端不依赖系统 C 运行库。

| 系统 | 架构 | DBX target | GitHub runner |
| --- | --- | --- | --- |
| Windows | Intel / AMD 64 位 | `windows-x64` | `windows-2022` |
| Windows | ARM64 | `windows-arm64` | `windows-11-arm` |
| macOS | Intel | `darwin-x64` | `macos-15-intel` |
| macOS | Apple Silicon | `darwin-arm64` | `macos-15` |
| Linux | x64 | `linux-x64` | `ubuntu-22.04` |
| Linux | ARM64 | `linux-arm64` | `ubuntu-22.04-arm` |

覆盖 DBX 插件工具链支持的六个桌面目标；不包括 Android、iOS 或 32 位系统。用户电脑仍需满足 DBX 本身的运行要求。

## 第一次运行

1. 将项目源码同步到 GitHub 默认分支，包含 `.github/` 和 `.agents/skills/dbx-plugin/`。后者的检查脚本会用于 CI，不能漏掉。
2. 打开仓库 **Actions → Build Wait Work packages → Run workflow**，选择需要构建的分支。
3. 等待六个平台构建以及汇总任务通过，在运行页面的 **Artifacts** 下载 `waitwork-all-platforms`。
4. 解压后选择对应系统与架构的 `.dbxp` 安装。

手动运行仅生成 Actions 下载产物，不创建 Release。各平台执行单元测试、Go 测试、前端构建、项目预检、官方 CLI 打包和包内完整性检查。

不需要配置自定义 Secret。创建 Release 草稿的任务使用 GitHub 自动提供的 `GITHUB_TOKEN`，只有该任务申请 `contents: write` 权限。

## 生成 Release 草稿

1. 同步修改 `manifest.json`、`package.json`、`package-lock.json` 中的版本，以及 `backend/main.go` 的 SDK Metadata 版本。
2. 更新 `docs/release-notes.md`，记录本次变化。
3. 执行 `npm run release:check` 检查版本一致性。提交并同步源码后，创建并推送匹配的版本标签，例如当前版本为 `v0.6.2`。标签只标记某次提交，不会自动修改上述文件里的版本号。
4. 标签触发 Actions；全部六个平台成功并通过汇总检查后，自动创建 **Wait Work v0.6.2** Release 草稿。
5. 到仓库 Releases 检查草稿和附件，然后点击 **Publish release**。

标签必须严格匹配 `v` 加插件版本号；任何一个平台失败，都不会进入 Release 草稿步骤。使用草稿可先上传全部资产，兼容 GitHub 的不可变 Release 设置。

如果旧标签指向版本号未修改的提交，在网页点击 Re-run 仍会构建那份旧源码，推送默认分支的新代码也不会改变旧标签。应使用与当前源码版本一致的新标签 `v0.6.2`，无需移动旧标签。已有商店候选仍绑定已发布的版本；只有新版本实际发布并重新校验下载包后，才能更新候选的版本、下载地址和哈希。

草稿包含六份 `.dbxp`、六份 `.artifact.json` 和一份 `release-candidates.json`。聚合文件中的下载项使用纯文件名，供 DBX Store 自动同步器读取。包内声明、SHA-256、文件大小、未签名状态和 macOS / Linux 可执行权限均会检查。

工作流不会覆盖已有同名 Release。若失败后遗留未发布草稿，先检查并删除该草稿，再重跑失败的任务；已发布版本有变化时必须升版本。

## 签名与上架

GitHub Release 中的包是未签名候选，本地安装需启用 DBX 的“允许安装未签名开发包”。官方商店签名仍由 DBX Store 审核工作流完成。

许可证已确定为 Apache-2.0，商店介绍已放入 `.dbx-store.json`；发布者登记和首次候选材料见 [上架说明](store-submission/README.md)。`release-candidates.json` 用于发布资产聚合，不等于已经提交商店审核。自动同步会读取 Release 标签下的 `.dbx-store.json`，新加的文件需要进入后续版本标签。

参考：[GitHub runner 平台说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[DBX Store 提交说明](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md)。

## 从本地开发版迁移

旧 ID `local.xidu.reader` 与正式 ID `monstercat.waitwork` 是两个插件，DBX 不会用新版覆盖旧插件。关闭旧版工作台后再使用新版，避免两个后端同时写同一个书架。

新版沿用系统配置目录下的 `waitWork` 数据目录，因此同一系统账户下的小说和进度可以继续读取。Windows 为 `%APPDATA%\waitWork\`，macOS 为 `~/Library/Application Support/waitWork/`，Linux 为 `$XDG_CONFIG_HOME/waitWork/`（未设置时为 `~/.config/waitWork/`）。
