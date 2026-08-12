# Store listing — Save as WDF (v0.1.0)

Submission material for Chrome Web Store and addons.mozilla.org (T18.8,
plan §10.32). The zips come from `pnpm --filter @wdf-dev/extension package`:
`dist/wdf-save-as-wdf-chrome-0.1.0.zip` / `…-firefox-0.1.0.zip`.

## Shared

- **Name:** Save as WDF
- **Category:** Productivity (CWS) / Other (AMO)
- **Language:** English
- **Homepage:** https://wdf.dev
- **Privacy policy URL:** https://wdf.dev/extension-privacy.html
- **License:** Apache-2.0 (source: https://github.com/paoloomero/wdf, `packages/extension`)

## Summary (CWS ≤132 chars / AMO ≤250 chars)

> Save the page you are reading as a verifiable document — article
> extracted, offline, fully on your machine. Zero data collected.

## Description

> **Save as WDF** turns the page you are reading into a document you can
> keep, send and verify — with one click.
>
> - **What you see is what you save.** The capture starts from the
>   rendered page in _your_ browser: content mounted by JavaScript and
>   pages behind your login are captured exactly as you see them — things
>   a server-side "save page" tool can never reach.
> - **Article extraction by default.** Menus, cookie banners, sticky
>   headers and hidden widgets are removed using what only the rendering
>   knows (geometry); or switch to full-page capture.
> - **Two outputs.** A standalone `.wdf.html` — opens in any browser,
>   offline, with the viewer embedded — or the bare `.wdf` package for
>   the WDF Reader and tooling.
> - **Verifiable.** Every document carries cryptographic hashes, a
>   machine-readable layer kept provably in sync with what humans read,
>   and capture provenance (URL, time, viewport) — the WDF Reader shows a
>   verification badge and flags any tampering.
> - **Radically private.** No accounts, no servers, no analytics, no
>   network requests of its own. Everything is converted on your machine.
>
> WDF (Web Document Format) is an open, web-native document format:
> https://wdf.dev

## Single purpose (CWS)

> Convert the currently viewed page, on the user's explicit action, into
> a WDF document downloaded to the user's computer.

## Permission justifications (CWS)

- **activeTab** — read the page the user chose to capture, only after
  the user's click on the extension.
- **scripting** — inject the capture script into that page at click
  time; there is no static content script and no host permission.
- **storage** — one local flag: the acknowledged one-time privacy
  notice.

## Data-use disclosures (CWS "Privacy practices")

- Collects **no** user data of any category. Nothing is transmitted.

## AMO notes

- **Add-on ID:** `save-as-wdf@wdf.dev` (in the manifest,
  `browser_specific_settings.gecko`).
- **Source code submission** (bundles are minified): public repository
  https://github.com/paoloomero/wdf. Build from the repo root with
  Node 22 and pnpm 10 (`corepack enable`):
  `pnpm install --frozen-lockfile && pnpm build` — the reviewable output
  is `packages/extension/dist/firefox/`. The build is reproducible:
  esbuild bundles `packages/extension/src/*` with the workspace packages
  `@wdf-dev/core` and `@wdf-dev/import`; the large string in `background.js` is
  the embedded offline viewer template (`@wdf-dev/viewer`).

## Screenshots

`store/screenshot-popup.png` and `store/screenshot-reader.png`
(1280×800), regenerated with `node scripts/store-screenshots.mjs`.
