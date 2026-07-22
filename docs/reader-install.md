# WDF Reader — install and end-to-end chain test (T8.2)

The hosted viewer is an installable PWA (Chrome/Edge on macOS, Windows,
Linux) registered as the handler for `.wdf` files. This is the manual test
of the full chain: **Word document → HTML export → WDF conversion → double
click opens the Reader**.

## 1. Serve or publish the site

Locally:

```sh
pnpm demo
node scripts/serve-site.mjs   # http://localhost:8642
```

(or any static server on `_site/`; once the project is on GitHub Pages the
public URL works the same, over HTTPS).

## 2. Install the Reader

1. Open `http://localhost:8642/viewer.html` in Chrome or Edge.
2. Click the **install icon** in the address bar (or ⋮ → _Cast, save and
   share_ → _Install page as app_).
3. The "WDF Reader" app appears with its icon; it opens in its own window
   and works offline (the shell is cached by a service worker).

## 3. Produce a `.wdf` from a Word document

1. In Word: _File → Save As → Web Page, Filtered_ (`.htm`). Keep the
   images folder Word creates next to it, if any. (Pages: export to Word
   first, or use any HTML export.)
2. Convert:

   ```sh
   node packages/cli/dist/index.js import "Documento.htm" -o Documento.wdf
   node packages/cli/dist/index.js validate Documento.wdf
   ```

   The import report lists everything translated or dropped (styles are
   translated into the package stylesheet; local images are pulled in).

## 4. The double click

- Double-click `Documento.wdf` in Finder / Explorer.
- The first time, the OS may ask which app to use: choose **WDF Reader**
  (on macOS: right-click → _Open With_ → _WDF Reader_ → _Always_).
- The Reader opens the document: verified badge, Human/Agent toggle,
  outline, citations. From the terminal, `open Documento.wdf` (macOS)
  exercises the same file association.

## Known limits (stated by design)

- `file_handlers` is currently a Chromium feature: on Safari/Firefox the
  Reader is not installable as a file handler; drag & drop into the viewer
  and the standalone `.html` distribution remain the universal paths.
- The install is per-machine, once. A native wrapper (Tauri) with OS-level
  file association on every browser/OS is the planned Fase 1 deliverable
  (see plan §10.4 T8.3).

## Pending audit

Lighthouse (mobile ≥ 90 + installability) to be run from desktop Chrome
DevTools on the served site — record the score here.
