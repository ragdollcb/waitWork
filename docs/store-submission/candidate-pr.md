## Plugin submission

- Plugin ID: `monstercat.waitwork`
- Version: `0.5.0`
- Publisher ID: `monstercat`
- Targets: `windows-x64`, `windows-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`

This first-submission PR includes both `publishers/monstercat.json` and `candidates/monstercat.waitwork.json`, following the store's single-PR submission process.

### Signing workflow note for maintainers

The current `.github/workflows/sign-plugin-pr.yml` removes `publishers/` and restores it from the base branch before candidate validation. Since `monstercat` is a new publisher, please preserve or register this publisher before that step, or adjust the workflow to retain reviewed new publisher records. Otherwise the candidate can fail with `publisher 'monstercat' is not registered`. This is separate from the expected pre-signing CI gate; it does not change the candidate package bytes.

## Source repository and tag

- Repository: https://github.com/ragdollcb/waitWork
- Build tag: https://github.com/ragdollcb/waitWork/tree/v0.5.0
- Exact build commit: https://github.com/ragdollcb/waitWork/tree/dfc7b1117b898a47380b38034ef83302cc782b30
- Build workflow: https://github.com/ragdollcb/waitWork/actions/runs/35177784556
- Unsigned release: https://github.com/ragdollcb/waitWork/releases/tag/v0.5.0

The release packages have not been rebuilt or replaced. The license declaration was added separately after this release; the repository's `NOTICE` explicitly covers the original waitWork code at the above commit.

## Capabilities and user workflow

Contributes one workbench named waitWork. Users import their own local TXT novels, browse chapters, adjust font size/theme, and resume automatically saved reading progress.

The reading surface deliberately resembles a SQL query editor: novel text is rendered as comments, and hiding the text shows a long sample SQL statement and static sample results. Leaving the workbench automatically hides the novel; Esc or the SQL button restores it. It does not execute SQL against a database.

Supports UTF-8, GB18030/GBK, BOM-marked UTF-16, and removal of NUL characters in decoded text. The bundled demo text is original project content; no user novels are included.

## Permissions, data access, and network access

- Manifest permissions: `[]`; no optional Host API permissions are requested.
- Frontend uses `window.dbxPlugin.invoke` to call the plugin's own local backend for persistence.
- Reads TXT or legacy JSON archives explicitly selected by the user through the file picker.
- Stores imported novel text, bookshelf metadata, reading position, and settings locally. There are no accounts, credentials, analytics, cloud storage, online book sources, or runtime network requests.
- Does not access DBX database credentials or execute database queries.

## Native sidecar behavior

A native Go sidecar communicates with DBX over stdio JSON-RPC. It starts no subprocesses, opens no listening ports, and runs no external commands.

The backend reads/writes `library.json` and content-addressed text chunks under the OS user configuration directory:

- Windows: `%APPDATA%\waitWork\`
- macOS: `~/Library/Application Support/waitWork/`
- Linux: `$XDG_CONFIG_HOME/waitWork/`, or `~/.config/waitWork/` when unset

`WAITWORK_DATA_DIR` can override the data directory for isolated development/testing. Writes use temporary files and rename; the backend removes unreferenced text chunks after a successful bookshelf update. It does not delete the original imported TXT files. The data directory is shared with the earlier local development plugin, so users should close that old plugin before using this one.

## License

Apache-2.0, copyright 2026 monstercat.

- License: https://github.com/ragdollcb/waitWork/blob/master/LICENSE
- Copyright and v0.5.0 scope: https://github.com/ragdollcb/waitWork/blob/master/NOTICE
- Third-party dependencies and vendored development tools retain their original licenses.

## Homepage or support URL

- Homepage: https://github.com/ragdollcb/waitWork
- Issues: https://github.com/ragdollcb/waitWork/issues

## Confirmation

- [x] The candidate packages are unsigned and match the disclosed source tag.
- [x] I have not included private keys, tokens, credentials, or proprietary data.
- [x] The candidates are listed in `candidates/monstercat.waitwork.json`; `plugins/` and `catalog/` were not edited manually.
