# waitWork 商店提交材料

当前申请版本为 **0.5.2**，发布者为 `monstercat`，插件 ID 为 `monstercat.waitwork`。

## 已准备的文件

- `publishers/monstercat.json`：首次登记发布者。
- `candidates/monstercat.waitwork.json`：六个平台的未签名候选下载地址、SHA-256 和大小。
- `candidate-pr.md`：按官方 PR 模板填写的完整正文。
- `publisher-pr.md`：旧拆分方案说明，不用于本次提交。

前两个文件已放入 `E:\github\dbx-store` 的同名路径，当前分支为 `submit-waitwork-0.5.2`。另外已在 `automation/plugin-sources.json` 登记 `ragdollcb/waitWork`，开启后续 Release 自动发现。商店提交共涉及这三个 JSON 文件，不需要复制插件源码或安装包。

## 提交步骤

1. 在 `E:\github\dbx-store` 检查并提交上述三个 JSON 文件。
2. 自行将 `submit-waitwork-0.5.2` 分支推送到 `ragdollcb/dbx-store`。本次准备工作未执行 push。
3. 已创建 PR #39：目标 `t8y2/dbx-store:main`，来源 `ragdollcb/dbx-store:submit-waitwork-0.5.2`。后续提交推送到同一分支即可更新，不需要再建 PR。
4. 标题使用 `feat(store): submit monstercat.waitwork@0.5.2`，正文复制 `candidate-pr.md`。启用 Allow edits from maintainers，方便官方签名流程回写。
5. 等待维护者审核、签名和合并。原 PR #35 已关闭且未合并，完整申请位于 https://github.com/t8y2/dbx-store/pull/39 。

比较页面：https://github.com/t8y2/dbx-store/compare/main...ragdollcb:dbx-store:submit-waitwork-0.5.2?expand=1

## 校验记录

- Release：https://github.com/ragdollcb/waitWork/releases/tag/v0.5.2
- 成功构建：https://github.com/ragdollcb/waitWork/actions/runs/35199359970
- 精确源码提交：`87cec337fbb3990ce0246480ad7c77a9570d014c`。
- 六个平台安装包及元数据均从已公开 Release 下载，未重新打包。
- SHA-256、大小、包内声明、版本、未签名状态、内部校验和及 macOS/Linux 后端可执行权限均通过检查；聚合元数据与六份独立元数据一致。
- 商店官方 `node scripts/validate.mjs --plan-candidates` 已通过，包含一个候选、六个平台。
- 官方校验器会生成 `catalog/index.json`；检查后已恢复原文件，提交中不包含目录生成结果。
- 下载文件保存在插件项目的 `.dbx-dev/store-submission/v0.5.2/`，不会进入商店仓库。

普通 CI 在待签名候选存在时报告 `open candidate(s) awaiting DBX Store signing` 是预期阻断。外部分支的 workflow awaiting approval 需要维护者批准运行。

## 维护者需要处理的签名问题

检查时官方 `sign-plugin-pr.yml` 仍会用 base 分支的 `publishers/` 和 `automation/` 覆盖 PR 分支，新发布者和自动更新登记可能因此丢失。PR 正文已提醒维护者在签名前保留或登记这两项，或修复工作流。这不改变官方规定的单 PR 提交流程。

`plugins/` 和 `catalog/` 由维护者签名后自动生成，本次未修改。`automation/plugin-sources.json` 已开启自动更新登记，生效后仍需要维护者审核、签名和合并每次更新。

参考：[官方提交说明](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md)、[签名工作流](https://github.com/t8y2/dbx-store/blob/main/.github/workflows/sign-plugin-pr.yml)。
