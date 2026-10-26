# Drizzle Explorer

A DBeaver-style desktop database explorer built on **Bun** — no Electron, no Node.

| Layer | Tech |
|---|---|
| Runtime / packaging | Bun 1.4 (`bun build --compile` → single self-contained executable) |
| Window | [webview-bun](https://github.com/tr1ckydev/webview-bun) — FFI binding to the system WebView (WKWebView / WebKitGTK / WebView2) |
| Database access | [drizzle-orm](https://orm.drizzle.team) `1.0.0-rc` (`drizzle-orm/bun-sql` for PostgreSQL, `drizzle-orm/bun-sqlite` for SQLite) |
| UI | React 19 + Vite + Tailwind v4 + [shadcn](https://ui.shadcn.com) on [Base UI](https://base-ui.com) primitives |
| Data grid | [AG Grid](https://www.ag-grid.com) Community |
| SQL editor | CodeMirror 6 (`@codemirror/lang-sql`) |

## Features

- Connection manager for **PostgreSQL** and **SQLite** (persisted to `~/.config/drizzle-explorer/connections.json`)
- Schema tree: schemas → tables / views / **functions & procedures** (PostgreSQL), lazy loading, connect-on-expand
- Table view: paginated data grid with server-side sorting and **filters** (column conditions + raw `WHERE`),
  plus Columns / Indexes / Foreign keys / DDL tabs
- **Column filters** under the header, all evaluated by the database: a value picker with search and a "(NULL)" entry
  for primary keys, foreign keys (shown with a label from the referenced row), enums and booleans; operator + number for numeric columns; operator + date picker for
  date/time columns; a "contains" box for everything else (the popup offers more operators, including `IS NULL`).
  They combine with the filter bar and apply to exports of the table.
- **Row editing** in the table view, DBeaver-style: edit cells inline (double-click / Enter), add rows, mark rows for
  deletion, then **Save** applies everything in one transaction (or Discard). Rows are addressed by primary key, or by
  `ctid` / `rowid` when there is none; views stay read-only. Cell context menu: edit, set NULL, copy, delete, add.
  Editors follow the column type: enum → select (PostgreSQL enums, SQLite `CHECK (col IN (…))`), date / timestamp /
  time → native picker working in the column's display time zone, boolean → true/false, foreign key → searchable
  picker over the referenced table (and "Open referenced row" in the context menu).
- **Column formatting** from the column header menu (⋯ or right-click): date format presets or a custom pattern,
  any IANA time zone, "show as date" for Unix-epoch numbers (s/ms/µs/ns, auto-detected), number grouping/decimals.
  Per table/column, persisted locally; a global default for all date columns.
- **Value viewer** side panel for long text and JSON cells (pretty-print, wrap, copy) with in-place **editing**
  (Edit → Apply / Set NULL) that feeds the same Save transaction as the grid
- Table footer stats: column count, selected rows, focused cell, totals
- Routine view: signature, language, comment and the full `CREATE FUNCTION` body
- SQL editor with syntax highlighting, table-name completion, `⌘/Ctrl+Enter` to run, a Format button
  (`sql-formatter`, PostgreSQL/SQLite dialects), results in the grid
- **Export** table rows or query results to CSV / JSON / XLSX; **import** CSV / JSON / XLSX into a table with
  Export lets you pick and rename the output columns and add SQL expression columns (`upper(label)`, `now()`).
  Import and copy-rows map each *target* column to a source column or to a SQL expression evaluated by the target database (`now()`, `'constant'`, `gen_random_uuid()`), and choose what happens on a duplicate key: fail, skip existing rows, or update them (upsert by primary key).
  column mapping; **copy rows** between tables and connections (e.g. PostgreSQL → SQLite)
- Context menus in the tree: open, export / import / copy rows, **truncate**, **drop** (tables, views, functions, procedures)
- **Dump & restore**: PostgreSQL through `pg_dump` / `pg_restore` / `psql` (whole database or one schema, plain SQL or
  custom archive, schema-only / data-only); SQLite through a built-in SQL dumper/restorer. Runs as background jobs with a live log.
- **AI assistant** side panel (status bar → Assistant) powered by the Claude Agent SDK on top of your **Claude Code
  login** (subscription or API key, whatever `claude` is logged in with; no extra key needed). It gets read-only tools:
  list connections/schemas/tables, describe tables, show a table with filters/sort, run SELECT analytics in a
  read-only transaction, draft a query. Every query it writes lands, pretty-printed, in its own **Assistant
  playground** tab (one per chat: a SQL editor with results), never in the chat; the chat is prose only. The current
  tab is sent as context. Streams tokens and tool calls live; chats are persisted locally. Under the prompt: model and
  reasoning-effort choosers per chat and a usage-limit gauge; the settings dialog shows the logged-in Claude account /
  plan, switches between the Claude subscription and an Anthropic API key, and sets defaults. The chat UI is built
  from shadcn's AI Elements patterns (message, bubble, trace, code-block, input-group, hover-card, progress).
- Native macOS menu (Edit → Cut/Copy/Paste/Select All, Cmd+Q, Cmd+W) so keyboard shortcuts work in the webview
- **Settings page** (gear in the status bar, Cmd+, or the macOS app menu, which also has *Check for Updates…*): sections General, Table data, Assistant (account, billing mode, default model, limits) and Updates & about; light / dark / system theme, table mode **pages vs. infinite scroll**
  (AG Grid infinite row model, blocks of 200; editing works in both modes, new rows are pinned on top while unsaved), default page size, update checks
- **Updates**: checks the latest GitHub release of `Wyesoftware/drizzle-explorer` on start (and on demand), shows a
  toast and a status-bar badge; releases built by the workflow can be installed in place (download, checksum, swap,
  restart). See "Updating the app" and "Releasing" below.

## Architecture

```
src/
  main/      Bun main process: opens the webview window, spawns the backend worker
  server/    Backend (runs in a Worker): HTTP RPC endpoint, drivers, connection store, static UI
  shared/    Types shared by backend and UI (RPC contract)
  ui/        React app (Vite root)
scripts/     dev / serve / build
```

The webview's native event loop blocks the main thread, so the backend runs in a **Worker** and
serves `POST /rpc` (JSON) plus the built UI on `127.0.0.1:<random port>`. The UI talks to it
through a typed `rpc(method, params)` client (`src/shared/types.ts` is the contract).

## Development

```bash
bun install
bun run dev            # Vite dev server (HMR) + native window pointed at it
bun run dev --watch    # also restart the window/backend when server files change
bun run serve:dev      # backend only (RPC on :4817) — open http://localhost:5173 in any browser
bun run typecheck
```

Set `DRIZZLE_EXPLORER_CONFIG_DIR` to use a different config directory (handy for testing).

## Build

```bash
bun run build                              # → dist/bin/drizzle-explorer (+ dist/Drizzle Explorer.app on macOS)
bun run build --target bun-linux-x64       # cross-compile (Linux needs GTK 4 + WebKitGTK 6 at runtime)
bun run build --target bun-windows-x64     # Windows (WebView2 runtime required on Windows 10)
```

The build runs Vite, generates `src/main/assets.generated.ts` (file imports so Bun embeds every
UI asset into the binary), compiles with `bun build --compile`, then restores the placeholder.

### PostgreSQL dump / restore

The app shells out to the PostgreSQL client tools, like DBeaver does. It looks for `pg_dump`, `pg_restore` and `psql`
on `PATH`, in the usual Homebrew / Postgres.app / Linux package locations, and in `DRIZZLE_EXPLORER_PG_BIN` if set.

```bash
brew install libpq        # macOS; binaries land in /opt/homebrew/opt/libpq/bin
```

Use client tools that are at least as new as the server. A dump made by a newer `pg_dump` may contain settings an older
server rejects (e.g. `transaction_timeout` from PostgreSQL 17); restore it with "Stop at the first error" off.

### AI assistant requirements

The assistant runs through the Claude Code runtime. In development the SDK uses its bundled binary; the packaged app
calls the `claude` CLI found on `PATH` (or `~/.local/bin`, Homebrew). Install Claude Code and log in once
(`claude` → `/login`), or export `ANTHROPIC_API_KEY`. Data access from the assistant is read-only by construction
(read-only transactions on PostgreSQL, a read-only connection on SQLite).

### macOS notes

- `dist/Drizzle Explorer.app` is an unsigned bundle. Sign it with `codesign` (see Bun's
  [executables docs](https://bun.com/docs/bundler/executables)) before distributing.
- The file picker uses `osascript`; on Linux it uses `zenity`/`kdialog`, on Windows PowerShell.

## Updating the app

`app.checkUpdate` compares the `package.json` version with the newest GitHub release of `UPDATE_REPO`
(`src/shared/types.ts`, `Wyesoftware/drizzle-explorer`); the check on start can be turned off in Settings → Updates. When the release carries a build for this machine
(`drizzle-explorer-<version>-<platform>-<arch>.zip|tar.gz` plus its `.sha256`), the toast and Settings offer
**Install and restart**: `app.installUpdate` runs as a job that downloads the asset, verifies the SHA-256,
extracts it, swaps the installation (the `.app` bundle on macOS, the executable elsewhere), launches the new copy
and ends the running one. Leftovers (`.Drizzle Explorer.app.old`, `drizzle-explorer.old`) are removed on the next start.
Without a matching asset the UI falls back to a link to the release page. Updating only works from the packaged app
(not `bun run dev`) and needs write access to the install directory.

## Releasing

`.github/workflows/release.yml` runs when a GitHub release is **published** (or manually for an existing tag):

1. Create a release with tag `vX.Y.Z` (the workflow writes that version into `package.json` before building).
2. Builds run for macOS arm64 + x64, Linux x64 + arm64 and Windows x64 on Bun 1.4.4; each job runs the typecheck
   and unit tests, packages `dist/release/<asset>` + `<asset>.sha256` (`scripts/package.ts`) and uploads both to the release.
3. macOS bundles are signed with the hardened runtime (`scripts/macos/entitlements.plist`, JIT + library-validation
   exceptions Bun needs), notarized and stapled by `scripts/macos-sign.sh`. Configure these repository secrets:

   | Secret | Value |
   | --- | --- |
   | `MACOS_CERTIFICATE` | base64 of the *Developer ID Application* certificate exported as `.p12` (`base64 -i cert.p12 \| pbcopy`) |
   | `MACOS_CERTIFICATE_PASSWORD` | password of that `.p12` |
   | `APPLE_ID` | Apple ID of the developer account |
   | `APPLE_TEAM_ID` | 10-character team id |
   | `APPLE_APP_PASSWORD` | app-specific password for that Apple ID (appleid.apple.com) |

   Without the secrets the macOS build is ad-hoc signed and Gatekeeper will warn on other machines. Windows binaries
   are not signed (SmartScreen may warn on first run).

### Local builds, icon and signing

`bun run build` produces `dist/Drizzle Explorer.app` with the app icon (`assets/AppIcon.icns`, regenerated from
`assets/icon.svg` with `bun run icon`) and signs it with the best identity in your keychain: a *Developer ID
Application* certificate if you have one, otherwise an *Apple Development* certificate (valid on your own Mac only,
Gatekeeper on other machines still needs Developer ID + notarization), otherwise ad-hoc. Set `CODESIGN_IDENTITY` to
pick a specific one, or run `bun run build:unsigned` to skip signing. With a Developer ID identity and
`APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_PASSWORD` in the environment the local build is notarized and stapled too.

## Known limitations

- Postgres sessions are tagged with `application_name = "Drizzle Explorer (<os user>)"` (also `PGAPPNAME` for dump/restore), so they are easy to spot in `pg_stat_activity`.
- UI preferences (settings, theme, column formats) are stored in `ui-state.json` in the config directory; connections in `connections.json`.
- Credentials are stored in plain JSON. Use a read-only DB user or keychain integration (TODO).
- Ad-hoc SQL results with duplicate column names collapse to one column (rows are objects).
- Single window; no tray (the webview library is deliberately minimal). The menu bar exists only on macOS.
- Compiled binaries are ~90 MB because they contain the Bun runtime.
- Binary (`bytea`/BLOB) values are previewed, not transferred byte-for-byte, by export/import/transfer.
- XLSX export/import is built in memory; use CSV for very large tables.
- The raw `WHERE` filter is sent to the database verbatim.
- Edits are typed as text and coerced by the database/column type; binary columns cannot be edited inline.
