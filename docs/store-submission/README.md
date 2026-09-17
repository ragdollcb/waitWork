# waitWork 首次上架材料

插件：`monstercat.waitwork@0.5.0`。发布者：`monstercat`。许可证：`Apache-2.0`，版权署名：`2026 monstercat`。

## 已准备的内容

| 文件 | 用途 |
| --- | --- |
| 项目根目录 `LICENSE`、`NOTICE` | 许可证及版权声明，明确覆盖 v0.5.0 的原创代码 |
| 项目根目录 `.dbx-store.json` | 商店介绍及以后版本自动同步时使用的元数据 |
| `publishers/monstercat.json` | 复制到 DBX Store 的同名路径，登记发布者 |
| `candidates/monstercat.waitwork.json` | 复制到 DBX Store 的同名路径，申请 v0.5.0 上架 |
| `publisher-pr.md` | 发布者登记 PR 正文 |
| `candidate-pr.md` | 插件候选 PR 正文，已按商店模板说明功能、权限、数据和 Go 后端行为 |

候选文件来自 GitHub 已发布的六平台安装包，绑定这些包的真实 SHA-256 和大小；不使用本地重打包的产物。源码固定到提交 `dfc7b1117b898a47380b38034ef83302cc782b30`，图标固定到 `v0.5.0` 标签。

## 提交顺序

1. 先将当前项目的许可证、NOTICE、README 和商店元数据提交并同步到 `ragdollcb/waitWork` 的默认分支，让审核者能打开 PR 中的许可证链接。本次补充许可和上架材料不修改 v0.5.0 的标签、代码或已发布安装包。
2. Fork `t8y2/dbx-store`。新建分支，只添加 `publishers/monstercat.json`，向上游 `main` 提 PR。标题：`feat(publisher): register monstercat`，正文使用 `publisher-pr.md`。
3. 等发布者登记合并，更新 fork 的 `main`，新建候选分支，只添加 `candidates/monstercat.waitwork.json`。标题：`feat(store): submit monstercat.waitwork@0.5.0`，正文使用 `candidate-pr.md`。
4. 维护者审核后运行签名流程；签名完成、CI 通过并合并后，插件才会上架。

需要提前发起候选讨论时，可以先开候选 Draft PR，并注明发布者登记 PR 的链接；发布者记录合并到 `main` 前不能签名。

分开登记的原因：当前商店签名流程会先以 `main` 的 `publishers/` 覆盖候选分支，因此首次新增发布者不能仅留在待签名的候选 PR 中。

普通校验在存在待签名候选时会报 `open candidate(s) awaiting DBX Store signing`，这是官方流程的预期阻断。审查候选字段使用：

```powershell
node scripts/validate.mjs --plan-candidates
```

## 本地验证记录

- 已从 v0.5.0 Release 下载六个 `.dbxp` 及对应 `.artifact.json`。
- 六个包的 SHA-256、大小、身份、版本、未签名状态、包内文件校验和均通过校验。
- macOS / Linux 包内后端可执行权限通过校验。
- 发布者记录通过官方商店 `scripts/validate.mjs` 校验。
- 在包含发布者记录的商店副本中，候选通过 `scripts/validate.mjs --plan-candidates` 校验。
- 当前材料仅在本地准备；生成这些文件不代表发布者已经登记或插件已经提交审核。

下载的二进制保存在被忽略的 `.dbx-dev/store-submission/v0.5.0/`；商店校验副本保存在 `.upstream/dbx-store-submission/`。二进制不提交到 DBX Store 仓库。

## 后续自动同步

这次采用手动候选方式申请 v0.5.0 上架。新加的 `.dbx-store.json` 位于默认分支，旧的 `v0.5.0` 标签中没有此文件。若后续登记自动同步，应让新版本标签包含该文件，再发布新的 Release；不要移动旧标签或覆盖旧包。

自动同步登记属于单独的后续步骤，本次未修改商店 `automation/plugin-sources.json`。

参考：[官方提交说明](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md)、[签名工作流](https://github.com/t8y2/dbx-store/blob/main/.github/workflows/sign-plugin-pr.yml)。
