# DBX 内嵌网站后续方案

目标：在 DBX 内打开抖音、Bilibili、小红书和 YouTube，尽量不离开软件。当前交付的是 Vue 小说阅读器，尚未实现这些网站入口。

## 已确认的宿主限制

核对基准是 `.upstream/dbx` 的提交 `69d3f028437f1ee1ab90a66a67ee0424966e88ca`，并非承诺所有后续版本都相同。

- `PluginWorkbenchHost.vue` 将插件运行在 `sandbox="allow-scripts"` 的 iframe 中，没有弹窗或顶层导航权限。
- `pluginHostBridge.ts` 注入的 CSP 使用 `default-src 'none'`，未开放外部 `frame-src`。
- `host.network:https://...` 只扩展 `connect-src`，不能用于嵌入完整站点。
- 当前桥接没有创建原生网页容器或打开外部网址的方法。Vue、普通 iframe 和增加业务 Sidecar 都不会自动获得这些宿主能力。

源码：[工作台容器](https://github.com/t8y2/dbx/blob/69d3f028437f1ee1ab90a66a67ee0424966e88ca/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue)、[桥接与 CSP](https://github.com/t8y2/dbx/blob/69d3f028437f1ee1ab90a66a67ee0424966e88ca/apps/desktop/src/lib/plugins/pluginHostBridge.ts)。

因此，当前正式插件 API 下不能直接用外部 iframe 加载这些完整网站。本项目未实现网站入口，也未修改上游 DBX。仍可探索由插件后端运行独立浏览器、向前端传回画面并接收输入的方案，不能把 iframe 的限制等同于所有实现路线都不可行。

## 实施顺序

1. 在 DBX 宿主验证可承载远程页面的原生 WebView，优先验证 Windows 和一个网站的真实播放、登录和窗口布局。是否能作为现有 Tab 内的区域承载，需要原型确认。
2. 宿主提供受控的创建、显示/隐藏、导航、关闭和状态事件接口；插件只传入经过允许列表校验的站点地址。这里的接口是待设计能力，不是现有 SDK 方法。
3. 在本插件的 `src/views/` 新增网站页面，从 `App.vue` 进行页面切换。小说页面保持挂载或将状态上移，避免切换模块丢失阅读位置。
4. 分别验证抖音、Bilibili、小红书和 YouTube。登录、验证码、Cookie、弹窗、全屏、视频编解码、网络可达性都以实际测试为准，不能仅凭首页加载成功就认为支持完成。
5. 收起功能必须同时隐藏原生网页容器、处理媒体声音和键盘焦点；网页内获得焦点时，当前小说页面的 `Esc` 监听不能直接代替宿主快捷键。

远程网站不能拿到插件的 `window.dbxPlugin` 或数据库/Tauri 能力。宿主需将远程网页与可信插件 UI 隔离，按需处理登录窗口和跳转。此方案不通过代理重写、移除站点安全响应头等方式绕过站点限制。

## 不修改宿主的备选路线：后端浏览器与画面传输

插件原生后端启动独立 Chromium，网站在该浏览器中正常导航；后端通过 DBX 的事件/二进制通道传回画面，Vue 使用 Canvas 等方式显示，并将鼠标、滚轮和键盘输入传回后端。这样前端 iframe 不直接加载远程网站。

Chromium DevTools Protocol 提供 `Page.captureScreenshot`、`Page.startScreencast` 以及 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 等基础能力。这支持原型验证，但不等于已经具备流畅的视频浏览体验。持续画面的帧率、编码和传输开销、声音、中文输入、登录持久化、窗口缩放和后台进程退出都需要单独实现与测试；截图/画面帧本身不包含声音。

可以先用机器上已安装的浏览器和独立用户目录做原型，无需一开始把浏览器内核打入安装包。若后续随插件分发浏览器，还需处理各平台构建、体积和浏览器更新。此路线目前只有可行性分析，没有实现或实测，也不能承诺特定网站登录和播放可用。

参考：[CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/)、[CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)。

系统浏览器独立窗口的外链方式不符合本项目当前的内嵌目标。
