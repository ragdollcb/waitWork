waitWork：等一会工作，休息一下。

本次 0.5.2 更新：统一前后端发布版本，解决标签与包内版本不一致导致的构建失败；补充 Apache-2.0 许可证声明和商店介绍资料。

- 导入本地 TXT 小说，支持 UTF-8、GB18030/GBK、UTF-16 和空字符清理。
- 自动保存书架、阅读进度和阅读设置。
- 小说以 SQL 注释样式显示，切换页面自动隐藏；在插件内按 Esc 或点击 SQL 恢复。
- 隐藏后显示长 SQL 和模拟结果表。
- Windows、macOS、Linux 分别提供 x64 和 ARM64 安装包。

选择与你的 DBX 系统和架构对应的 `.dbxp` 安装。GitHub Release 提供未签名候选包，本地安装需在 DBX 插件中心开启“允许安装未签名开发包”；官方商店签名后可按正常流程安装。

此版本使用正式插件 ID `monstercat.waitwork`，发布者为 `monstercat`。旧版 `local.xidu.reader` 会被识别为另一个插件；关闭旧插件后使用新版，同一系统账户下的 waitWork 数据目录保持不变。
