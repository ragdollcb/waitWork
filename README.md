# waitWork

**等一会工作，休息一下。** waitWork 是 DBX 的休息工具插件，当前提供本地 TXT 小说阅读。从“waitWork”工作台入口打开，内部显示为“新建查询”，正文以 SQL 注释样式呈现。切换页面自动收起，按 `Esc` 展开或收起。

使用 **Vue 3 + Vite + JavaScript** 构建界面，**Go 后端**自动保存本地书架。不联网、不上传小说。GitHub Actions 分别为 Windows、macOS、Linux 的 x64 / ARM64 架构构建安装包。

## 安装

1. 打开 DBX → 插件中心 → 设置 → 第三方与开发者选项。
2. 开启“允许安装未签名开发包”。
3. 从 [GitHub Releases](https://github.com/ragdollcb/waitWork/releases) 下载对应平台的包，例如 `monstercat.waitwork-0.5.0-windows-x64.dbxp`。本地构建产物位于 `dist/`。
4. 在已安装的 waitWork 插件中打开“waitWork”工作台。工作台入口的说明包含导入小说、阅读设置、隐藏／恢复和自动保存用法。更新后关闭旧标签再重新打开。

插件 ID 为 `monstercat.waitwork`，发布者为 `monstercat`，源码仓库为 [ragdollcb/waitWork](https://github.com/ragdollcb/waitWork)。GitHub 构建产物是未签名候选，官方商店通过 `t8y2/dbx-store` 审核签名。

旧开发版 `local.xidu.reader` 会保留为另一个插件。关闭旧版工作台后使用新版；系统配置目录下的 `waitWork` 数据位置不变，已有书架和进度可以继续读取。

项目原创代码与文档采用 [Apache-2.0](LICENSE)，版权署名为 monstercat，适用范围见 [NOTICE](NOTICE)。第三方依赖和开发工具保留各自许可证。商店首次提交材料见 [上架说明](docs/store-submission/README.md)。

## 阅读

- 默认显示月度经营分析查询与对应结果。点击右上角 `SQL` 或在插件内按 `Esc` 展开正文；不会在重新获得焦点时自动展开。
- 点击左上角侧栏图标，再点击“打开文件”，可导入多本 TXT 或旧版 JSON 存档。首次导入会替换内置示例小说。
- 自动识别 UTF-8、GB18030/GBK、带 BOM 的 UTF-16。乱码时先切换左侧 TXT 编码，再重新导入。自动清理解码后文本任意位置的空字符（NUL），无需预先转换原文件；只有空字符而没有正文时仍提示空文件。同时清理文件末尾旧阅读器的 `PIXTEL_MMI_EBOOK_2005` 位置标记，含此标记的 TXT 也可直接导入。
- 自动提取常见中文章节标题、`Chapter 1` 等英文标题。无章节或超长章节会按段拆分，正文不会一次性全部渲染。
- 点击侧栏“大纲”查找章节；底部进度条可跳转全书位置。
- 齿轮按钮调整字体、字号、行距、正文宽度和页面颜色；默认跟随宿主明暗主题。
- 在正文区域使用 `←` / `→` 切换章节，空格向下翻页，`Shift + 空格`向上翻页。
- 切换其他窗口、浏览器标签或 DBX 内部 SQL / 表格 / 页面时，插件失焦或被隐藏即自动收起；此行为始终开启。快捷键需要焦点位于插件内。
- 展开和收起均使用查询工具栏、文件标签、编辑器与结果面板。展开时小说显示为带行号的注释，收起后预置 838 行 SQLite 经营分析 SQL，包含 CTE、聚合、退款计算、环比和窗口排名，并显示 24 行、17 列的对应结果。支持语法高亮、行号、横向滚动和结果／消息切换。
- 伪装页使用本地样例数据和预先计算的查询结果，不连接用户数据库。编辑 SQL 后会标记“上次结果”，不会执行编辑后的语句；点击文件栏的恢复按钮可还原预置查询。SQL 草稿仅在当前会话保留，小说仍照常自动保存。
- 单本 TXT 上限 8 MB，书架最多 20 本，总正文上限约 2400 万 UTF-16 代码单元；存档上限 64 MB。

**书架、小说正文、阅读位置和设置会自动保存。** 导入、切书、翻章、滚动和修改设置后会更新本地数据，顶部显示“正在自动保存…”或“已自动保存”。保存失败会持续提示并自动重试；读取失败时会阻止编辑，避免覆盖旧数据。多个工作台使用同一后端时，过期窗口不能覆盖新书架。

已移除手动“导出存档”按钮。旧版 `.waitwork.json` / `.xidu.json` 仍可导入，确认替换后自动保存。0.2.0 的自动保存数据可直接沿用；0.1.0 尚未导出的临时会话无法在关闭后找回，需要先在旧版导出再导入。

Windows 数据位置为 `%APPDATA%\waitWork\`：`library.json` 保存书架索引、位置和设置，`texts/` 保存正文分块。它们位于插件安装目录之外，更新插件不会主动清除。每次只更新必要的数据，移除书籍会在索引提交后清理不再使用的正文；中途失败的导入可能留下尚未引用的分块。需要备份时，在关闭 DBX 后复制整个目录。其他平台使用 Go `os.UserConfigDir()` 下的 `waitWork` 目录。

平时每约 250 ms 合并保存一次变化，离开窗口或收起正文时立即尝试提交。页面关闭时的异步请求无法保证完成；请在顶部显示“已自动保存”后关闭，强制退出或断电仍可能丢失最后尚未写入的变化。

移除书籍不会删除原始 TXT。内置《雨停之前》是本项目的原创试读文本。

## 开发

需要 Node.js 22.12+ 和 Go 1.22+；当前开发环境为 Node.js 24 和 Go 1.26。

```powershell
npm ci

# Vue 开发服务器，5173 端口；单独打开时缺少后端桥接
npm run dev:ui

# 官方 DBX 插件开发宿主，默认 5190 端口
npm run dev

# 普通浏览器预览，5191 端口，连接真实 Go 后端
npm run preview

# 生成单文件 UI 和未签名安装包
npm run package
```

启动官方宿主后，点击左侧工作台中的“waitWork”。修改源码后执行 `npm run build`，再重载页面。重载后自动恢复上次保存的书架和进度。开发时可通过 `WAITWORK_DATA_DIR` 指定独立数据目录，避免影响正式书架。浏览器预览按会话保存到 `.dbx-dev/preview/`；浏览器测试使用隔离目录。Windows 下 CLI 0.1.9 的内部构建命令有长路径兼容问题，因此本项目在 `npm run dev` 中先完成构建，再启动宿主，不配置 `[dev].ui_build`。

## GitHub Actions 打包

- **手动构建**：Actions → Build waitWork packages → Run workflow，完成后下载 `waitwork-all-platforms`。
- **版本发布**：推送与源码版本一致的标签（当前 `v0.5.0`），六个平台全部成功后自动创建 Release 草稿；检查附件后手动发布。
- 无需配置自定义 Secret，工作流自动生成六份安装包、各包元数据和 `release-candidates.json`。

完整平台列表、发布步骤和旧版迁移说明见 [发布打包说明](docs/releasing.md)。

```text
src/App.vue                     应用入口，后续模块在此组合
src/views/ReaderView.vue         小说页面、书架状态、导入与自动保存
src/components/ReaderSidebar.vue 书架与目录
src/components/ReadingPane.vue   正文、翻章、滚动位置
src/components/ReaderSettings.vue 阅读设置
src/components/QueryToolbar.vue  查询工具栏
src/components/QueryCover.vue    收起后的查询页面
src/components/QueryResults.vue  查询结果外观
src/lib/privacy.js              失焦、页面隐藏与 iframe 可见性检测
src/lib/sql-highlight.mjs        SQL 安全分词高亮
src/data/query-demo.sql          可独立执行的样例查询
src/data/query-demo.json         对应结果快照
scripts/build-query-demo.py      生成并校验样例 SQL 与结果
src/lib/host.js                  DBX 后端桥接、正文分块与恢复
src/lib/autosave.mjs             串行保存、合并变化与失败重试
backend/main.go                 本地持久化、原子替换与版本冲突检查
src/reader.mjs                   编码解析、章节切分、存档校验
src/style.css                    阅读样式
src/sample.mjs                   原创示例
vite.config.js                  Vue 编译与单文件打包
ui/index.html                   构建产物，也是插件入口
manifest.json                   插件声明
dbx-plugin.toml                  打包范围
```

## 验证与兼容性

```powershell
npm test
npm run test:backend
npm run test:browser
```

浏览器测试默认使用已安装的 Microsoft Edge。其他环境可设置 `PLAYWRIGHT_CHANNEL=chrome` 使用 Chrome；测试会启动本地预览和官方 CLI 调试宿主。

覆盖编码、空文件、长章分段、存档校验，以及严格沙箱中的 TXT 导入、章节切换、阅读设置、收起恢复、自动保存恢复、空书架恢复、大文件分块、失败重试、读取失败保护、文本注入防护和窄屏布局，以及宿主内部切页、祖先 display:none、弹窗关闭焦点保护与收起后延迟导入确认。测试截图位于 `test-results/screenshots/`。

接口以 DBX 源码 `69d3f028437f1ee1ab90a66a67ee0424966e88ca`（项目版本 0.6.14）为核对基准，后端使用官方 Go SDK，通过 `window.dbxPlugin.invoke` 通信。严格沙箱测试与官方 CLI 宿主均连接真实 Go 后端；尚未在实际 DBX 桌面客户端安装验收。自动收起按当前 DBX 的 `v-show` 工作台行为实现并在严格 iframe 沙箱中验证；宿主若只用不透明浮层覆盖插件且不转移焦点，插件无法识别该遮挡。

目前未接入 EPUB 或在线书源。DBX 的不透明 iframe origin 无法可靠使用 `localStorage` / IndexedDB，因此持久化由 Go 后端完成。

## 后续内嵌网站

目标是在 DBX 内看抖音、Bilibili、小红书、YouTube。当前插件沙箱不允许直接用外部 iframe 加载完整网站。可探索宿主新增网页容器，或插件后端运行独立浏览器并向 Vue 传回画面、接收输入两条路线；本版未实现网站入口。已确认的限制与待验证方案见 [内嵌网站方案](docs/embedded-sites.md)。

参考：[DBX 插件开发文档](https://github.com/t8y2/dbx/blob/main/docs/content/docs/plugin-development.cn.mdx)、[前端桥接源码](https://github.com/t8y2/dbx/blob/main/apps/desktop/src/lib/plugins/pluginHostBridge.ts)。

修改样例查询生成逻辑后，可用 Python 标准库重新生成和验证结果（插件运行不需要 Python）：

```powershell
python scripts/build-query-demo.py
python scripts/build-query-demo.py --check
```
