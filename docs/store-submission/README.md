# waitWork 首次上架材料

插件：`monstercat.waitwork@0.5.0`。发布者：`monstercat`。许可证：`Apache-2.0`，版权署名：`2026 monstercat`。

## 已准备的内容

| 文件 | 用途 |
| --- | --- |
| 项目根目录 `LICENSE`、`NOTICE` | 许可证及版权声明，明确覆盖 v0.5.0 的原创代码 |
| 项目根目录 `.dbx-store.json` | 商店介绍及以后版本自动同步时使用的元数据 |
| `publishers/monstercat.json` | 复制到 DBX Store 的同名路径，登记发布者 |
| `candidates/monstercat.waitwork.json` | 复制到 DBX Store 的同名路径，申请 v0.5.0 上架 |
| `publisher-pr.md` | 历史拆分方案说明，不再用于当前 PR |
| `candidate-pr.md` | 完整首次上架 PR 正文，同时说明发布者登记和插件候选 |

候选文件来自 GitHub 已发布的六平台安装包，绑定这些包的真实 SHA-256 和大小；不使用本地重打包的产物。源码固定到提交 `dfc7b1117b898a47380b38034ef83302cc782b30`，图标固定到 `v0.5.0` 标签。

## 提交顺序

1. 先将当前项目的许可证、NOTICE、README 和商店元数据提交并同步到 `ragdollcb/waitWork` 的默认分支，让审核者能打开 PR 中的许可证链接。本次补充许可和上架材料不修改 v0.5.0 的标签、代码或已发布安装包。
2. 首次提交应在同一个 PR 中同时包含 `publishers/monstercat.json` 和 `candidates/monstercat.waitwork.json`，目标为 `t8y2/dbx-store` 的 `main`。
3. 当前已有 [PR #35](https://github.com/t8y2/dbx-store/pull/35)，来源分支为 `ragdollcb/dbx-store:main`。直接在这个分支补充 `candidates/monstercat.waitwork.json`，提交后会自动更新原 PR，无需另建 PR。标题改为 `feat(store): submit monstercat.waitwork@0.5.0`，正文使用 `candidate-pr.md`。
4. 维护者审核后运行签名流程；签名完成、CI 通过并合并后，插件才会上架。

此前将签名脚本的兼容问题当作必须拆成两个 PR 的理由，不符合官方提交文档的单 PR 流程；此处已纠正。只有维护者明确要求时再采用拆分登记方式。

签名阶段仍存在需要维护者处理的问题：当前 `sign-plugin-pr.yml` 会先以 `main` 的 `publishers/` 覆盖候选分支，新发布者记录可能因此丢失并导致 `publisher 'monstercat' is not registered`。新版 PR 正文已注明这一点，请维护者保留或预先登记该发布者，或修正工作流。补全候选文件解决的是申请内容缺失，不会自动修复官方签名脚本。

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
- PR #35 已提交发布者文件；本次检查时仍缺少候选文件，发布者登记也尚未合并。状态应以 GitHub 上的 PR 为准。

下载的二进制保存在被忽略的 `.dbx-dev/store-submission/v0.5.0/`；商店校验副本保存在 `.upstream/dbx-store-submission/`。二进制不提交到 DBX Store 仓库。

## 后续自动同步

这次采用手动候选方式申请 v0.5.0 上架。新加的 `.dbx-store.json` 位于默认分支，旧的 `v0.5.0` 标签中没有此文件。若后续登记自动同步，应让新版本标签包含该文件，再发布新的 Release；不要移动旧标签或覆盖旧包。

自动同步登记属于单独的后续步骤，本次未修改商店 `automation/plugin-sources.json`。

参考：[官方提交说明](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md)、[签名工作流](https://github.com/t8y2/dbx-store/blob/main/.github/workflows/sign-plugin-pr.yml)。
