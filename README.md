# Wait Work

English | [简体中文](README.zh-CN.md)

**Let work wait. Take a break.** Wait Work is a reading and break-time plugin for DBX, supporting local TXT, EPUB, and MOBI books as well as online reading from a custom book source. Open it from the “Wait Work” workbench entry; the tab appears as “New Query” (新建查询), with book text displayed as SQL comments. Reading automatically collapses when you switch pages. Press `Esc` to expand or collapse it.

The interface is built with **Vue 3 + Vite + JavaScript**, and a **Go backend** automatically saves your local bookshelf. Local books require no network access and are never uploaded. For online reading, the backend sends search terms and table-of-contents/chapter requests to the website you save in settings; book text and reading progress are stored locally. GitHub Actions builds packages for Windows, macOS, and Linux on both x64 and ARM64.

## Installation

1. Open DBX → Plugin Center → Settings → Third-party and Developer Options.
2. Enable “Allow unsigned development packages” (允许安装未签名开发包).
3. Download the package for your platform from [GitHub Releases](https://github.com/ragdollcb/waitWork/releases). Filenames follow `monstercat.waitwork-<version>-<platform>.dbxp`; for example, choose a package ending in `windows-x64.dbxp` for Windows x64. Locally built packages are placed in `dist/`.
4. Open the “Wait Work” workbench in the installed Wait Work plugin. The workbench entry description explains how to import books, adjust reading settings, hide/restore reading, and use autosave. After updating, close the old tab and reopen it.

The plugin ID is `monstercat.waitwork`, the publisher is `monstercat`, and the source repository is [ragdollcb/waitWork](https://github.com/ragdollcb/waitWork). GitHub builds are unsigned release candidates; official store review and signing are handled through `t8y2/dbx-store`.

The older development version, `local.xidu.reader`, remains installed as a separate plugin. Close its workbench before using the new version. The `waitWork` data directory under the system configuration directory is unchanged, so existing bookshelves and reading progress remain accessible.

Original project code and documentation are licensed under [Apache-2.0](LICENSE), with copyright attributed to monstercat. See [NOTICE](NOTICE) for the scope. Third-party dependencies and development tools retain their respective licenses. Initial store submission materials are available in the [store submission guide](docs/store-submission/README.md) (Chinese).

## Reading

- The default view shows a monthly business analysis query and its results. Click `SQL` in the upper-right corner or press `Esc` while focused inside the plugin to expand the book text. Reading does not automatically expand when focus returns.
- Click the sidebar icon in the upper-left corner, then “Open File” (打开文件) to import multiple TXT, EPUB, and MOBI books together, or import a legacy JSON archive on its own. The first import replaces the bundled sample novel.
- TXT import automatically detects UTF-8, GB18030/GBK, and UTF-16 with a BOM. If text appears garbled, change the TXT encoding in the sidebar and import again. NUL characters are automatically removed wherever they appear in the decoded text, so there is no need to convert the original file first. A file containing only NUL characters is still reported as empty. The legacy reader position marker `PIXTEL_MMI_EBOOK_2005` is also removed from the end of a file, allowing TXT files containing this marker to be imported directly.
- EPUB 2/3 and MOBI (including PalmDOC, HUFF/CDIC compression, and KF8/combined files) imports extract the title, plain text, and native table of contents for use in the same reading interface. Nested tables of contents are flattened in reading order, and chapter anchors within a single file can be navigated to individually. The table of contents, format, and reading progress are saved automatically with the bookshelf. Images, original book styling, audio, and video are not displayed; book scripts are not executed, and external resources are not loaded. Encrypted book text is not currently supported; font obfuscation alone does not prevent text import.
- Common Chinese chapter headings and English headings such as `Chapter 1` are detected automatically. Heading detection is used for TXT files and ebooks without a valid native table of contents. Books without chapters and very long chapters are split into sections, so the entire book is never rendered at once.
- Use “Outline” (大纲) in the sidebar to find chapters, or use the progress bar at the bottom to jump to a position in the book.
- Use the gear button to adjust the font, font size, line spacing, text width, and page colors. By default, the reader follows the host application's light/dark theme.
- In the reading area, use `←` / `→` to switch chapters, `Space` to page down, and `Shift + Space` to page up.
- Switching to another window, browser tab, or SQL/table/page view within DBX automatically collapses reading when the plugin loses focus or becomes hidden. This behavior is always enabled. Keyboard shortcuts require focus inside the plugin.
- Both expanded and collapsed views use a query toolbar, file tab, editor, and results panel. In the expanded view, the novel appears as comments with line numbers. The collapsed view shows a preset 838-line SQLite business analysis query with CTEs, aggregations, refund calculations, month-over-month comparisons, and window-function rankings, alongside matching results with 24 rows and 17 columns. Syntax highlighting, line numbers, horizontal scrolling, and Results/Messages tabs are supported.
- The query cover uses local sample data and precomputed results; it does not connect to your databases. Editing the SQL marks the results as “Previous results” (上次结果), and the edited statements are not executed. Click the restore button in the file bar to reset the preset query. SQL drafts last only for the current session; novels continue to save automatically as usual.
- Each TXT file is limited to 8 MiB. Original EPUB and MOBI files are limited to 32 MiB, with a cumulative decompressed-content limit of 64 MiB and a converted-text limit of 8 Mi UTF-16 code units per book. The bookshelf holds up to 20 books, with a total text limit of 24 Mi UTF-16 code units; archives are limited to 64 MiB. Tables of contents allow up to 10,000 entries and are also subject to the 1 MiB bookshelf index limit. Space for text indexes and later settings changes is reserved before import.
- When importing a mixed selection, books are added only after every file has been parsed successfully. If any book is damaged, encrypted, or exceeds a limit, the entire batch is canceled and the existing bookshelf is preserved.

**Your bookshelf, book text, reading position, and settings are saved automatically.** Importing, switching books or chapters, scrolling, and changing settings update local data. The status at the top shows “Autosaving…” (正在自动保存…) or “Autosaved” (已自动保存). Save failures remain visible and are retried automatically. If loading fails, editing is blocked to prevent existing data from being overwritten. When multiple workbenches share one backend, an outdated window cannot overwrite a newer bookshelf.

The manual “Export Archive” button has been removed. Legacy `.waitwork.json` / `.xidu.json` archives can still be imported and are saved automatically after you confirm replacement. Autosave data from version 0.2.0 can be used directly. Temporary sessions from version 0.1.0 that were not exported cannot be recovered after closing; export them from the old version before importing them here.

On Windows, data is stored in `%APPDATA%\waitWork\`: `library.json` holds the bookshelf index, reading positions, and settings, while `texts/` holds text chunks. These files are outside the plugin installation directory and are not actively cleared by plugin updates. Only the necessary data is updated each time. Removing a book cleans up unused text after the index is committed; interrupted imports may leave unreferenced chunks behind. To back up your data, close DBX and copy the entire directory. Other platforms use the `waitWork` directory under Go's `os.UserConfigDir()`.

During normal use, changes are batched and saved approximately every 250 ms. Leaving the window or collapsing the text triggers an immediate save attempt. Asynchronous requests are not guaranteed to finish when the page closes, so wait until the status shows “Autosaved” before closing. A forced exit or power outage may still lose the latest changes that have not yet been written.

Removing a book does not delete its original TXT, EPUB, or MOBI file. The bundled sample, *Before the Rain Stops* (《雨停之前》), is an original text written for this project.

## Online Reading

First, open Settings → **Custom Book Source** (自定义书源), enter an HTTPS website homepage URL, and save it. This field is empty by default. Then open Sidebar → **Online Search** (在线搜索), enter a book title or author, and select a result to view its description and table of contents. Click “Start / Continue Reading” (开始／继续阅读) or a chapter to add the book to your bookshelf. Opening an online novel for the first time replaces the bundled sample. Search-result pagination, chapter lookup, previous/next chapter navigation, and chapter-based progress navigation are supported.

The current parsing rules are adapted to `https://www.biquge001.com/` as an example only; the address is neither filled in nor accessed automatically. Other websites must use a compatible page structure—arbitrary URLs are not supported. Enter a URL you are authorized to access and follow the website's rules and copyright requirements. Clearing the URL or restoring default settings disables network access; existing cached content remains readable. Bookshelf records and caches are separated by source when you switch websites. To read uncached chapters from an old source, configure its URL again. Search, table-of-contents, and chapter requests are handled by the Go backend, including support for GBK-encoded websites. Webpage scripts are not executed, and remote ads and covers are not loaded. Rate limiting, network interruptions, or changes to page structure produce a message prompting you to retry.

Tables of contents and chapters you have opened are cached locally under `waitWork/online/`. Reopening a book restores the chapter and position within it. Cached chapters can be read offline; uncached chapters require a network connection. The cached table of contents is used by default. Click “Refresh Table of Contents” (刷新目录) under “Outline” to check for updates; if refreshing fails, the old table of contents is preserved. If caching fails, the chapter remains readable, but a message clearly indicates that it has not been cached.

Online and local novels share the 20-book limit. Removing an online novel clears its table-of-contents and text caches. Tables of contents previewed without adding the book may remain in the cache directory. Full-book downloads, custom parsing rules, and website login are not supported. Existing TXT bookshelves and legacy JSON archives remain readable; importing a legacy archive replaces the entire bookshelf as described in the confirmation.

## Development

Requires Node.js 22.12+ and Go 1.26+. The current development environment uses Node.js 24 and Go 1.26. HTML parsing and GBK decoding use the official Go extension libraries `golang.org/x/net` and `golang.org/x/text`.

```powershell
npm ci

# Vue development server on port 5173; no backend bridge when opened on its own
npm run dev:ui

# Official DBX plugin development host, on port 5190 by default
npm run dev

# Browser preview on port 5191, connected to the real Go backend
npm run preview

# Build the single-file UI and unsigned installation package
npm run package
```

After starting the official host, click “Wait Work” in the workbench list on the left. After changing source code, run `npm run build` and reload the page. The last saved bookshelf and reading progress are restored automatically. Set `WAITWORK_DATA_DIR` during development to use a separate data directory and avoid affecting your regular bookshelf. Browser previews save data per session under `.dbx-dev/preview/`; browser tests use isolated directories. On Windows, the internal build command in CLI 0.1.9 has long-path compatibility issues, so `npm run dev` builds the project before starting the host, without configuring `[dev].ui_build`. The startup script also bypasses that CLI version's temporary workspace pinned to Go 1.22 and uses the SDK pinned in the project's `go.mod`. The debug host still uses the official runtime.

## Packaging with GitHub Actions

- **Manual build:** Go to Actions → Build Wait Work packages → Run workflow, then download `waitwork-all-platforms` once the run completes.
- **Version release:** Synchronize and commit the frontend and backend versions, then push a tag matching the source version (currently `v0.6.2`). A draft release is created automatically after all six platform builds succeed. Check the attachments before publishing it manually. Creating a tag does not update project version numbers automatically.
- No custom secrets are required. The workflow generates six installation packages, metadata for each package, and `release-candidates.json`.

See the [release and packaging guide](docs/releasing.md) (Chinese) for the full platform list, release steps, and legacy migration notes.

```text
src/App.vue                      Application entry point; composes the modules below
src/views/ReaderView.vue          Reader page, bookshelf state, imports, and autosave
src/components/ReaderSidebar.vue  Bookshelf and table of contents
src/components/ReadingPane.vue    Book text, chapter navigation, and scroll position
src/components/ReaderSettings.vue Reading settings
src/components/QueryToolbar.vue   Query toolbar
src/components/QueryCover.vue     Collapsed query view
src/components/QueryResults.vue   Query results presentation
src/lib/privacy.js               Focus loss, page hiding, and iframe visibility detection
src/lib/sql-highlight.mjs         Safe SQL tokenization and highlighting
src/data/query-demo.sql           Standalone executable sample query
src/data/query-demo.json          Matching results snapshot
scripts/build-query-demo.py       Sample SQL and results generation and validation
src/lib/host.js                   DBX backend bridge, text chunking, and restoration
src/lib/autosave.mjs              Sequential saves, change batching, and failure retries
backend/main.go                  Local persistence, atomic replacement, and version conflict checks
src/reader.mjs                    Encoding detection/decoding, chapter splitting, and archive validation
src/style.css                     Reader styles
src/sample.mjs                    Original sample text
vite.config.js                   Vue compilation and single-file packaging
ui/index.html                    Build output and plugin entry point
manifest.json                    Plugin manifest
dbx-plugin.toml                   Package inclusion configuration
```

## Testing and Compatibility

```powershell
npm test
npm run test:backend
npm run test:browser
```

Browser tests use an installed Microsoft Edge by default. In other environments, set `PLAYWRIGHT_CHANNEL=chrome` to use Chrome. The tests start both the local preview and the official CLI debug host.

Coverage includes EPUB 2/3 and MOBI/KF8 imports, table-of-contents anchors and progress restoration, mixed-batch failure protection, rejection of encrypted or oversized files, encoding handling, empty files, long-chapter splitting, and archive validation. Tests also cover TXT imports inside a strict sandbox, chapter navigation, reading settings, collapse/restore behavior, autosave restoration, empty-bookshelf restoration, large-file chunking, failure retries, load-failure protection, text-injection protection, narrow-screen layouts, page switching within the host, ancestors with `display:none`, focus protection when dialogs close, and deferred import confirmation after collapsing. Test screenshots are saved under `test-results/screenshots/`.

API compatibility was checked against DBX source commit `69d3f028437f1ee1ab90a66a67ee0424966e88ca` (project version 0.6.14). The backend uses the official Go SDK and communicates through `window.dbxPlugin.invoke`. Both strict-sandbox tests and the official CLI host connect to the real Go backend; installation and acceptance testing in the actual DBX desktop client have not yet been completed. Automatic collapse follows DBX's current `v-show` workbench behavior and has been verified in a strict iframe sandbox. If the host merely covers the plugin with an opaque overlay without moving focus, the plugin cannot detect that obstruction.

Ebook parsing uses pinned commits of Foliate JS, zip.js, and fflate, all bundled locally. Calibre or other conversion software is not required. The MOBI parser is stored in `src/vendor/mobi.js`, with decompression quotas and damaged-record safeguards added on top of the pinned upstream commit. Licenses are included in `assets/THIRD-PARTY-LICENSES.txt`. DBX's opaque iframe origin cannot reliably use `localStorage` / IndexedDB, so persistence and access to online book sources are handled by the Go backend.

## Future Website Embedding

The goal is to make Douyin, Bilibili, Xiaohongshu, and YouTube available inside DBX. The current plugin sandbox does not allow complete external websites to be loaded directly in iframes. Two possible approaches are a new web container provided by the host, or a separate browser run by the plugin backend that streams its display to Vue and accepts input. This version does not implement website entries. See the [website embedding proposal](docs/embedded-sites.md) (Chinese) for confirmed limitations and approaches that still need validation.

References: [DBX plugin development documentation](https://github.com/t8y2/dbx/blob/main/docs/content/docs/plugin-development.cn.mdx) (Chinese), [frontend bridge source](https://github.com/t8y2/dbx/blob/main/apps/desktop/src/lib/plugins/pluginHostBridge.ts).

After changing the sample-query generator, use the Python standard library to regenerate and validate the results. Python is not required to run the plugin.

```powershell
python scripts/build-query-demo.py
python scripts/build-query-demo.py --check
```
