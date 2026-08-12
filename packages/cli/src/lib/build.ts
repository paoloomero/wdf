import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The real single-file viewer template built by @wdf-dev/viewer (plan T4.5). */
export function hasViewerTemplate(): boolean {
  return loadViewerTemplate() !== undefined;
}

function loadViewerTemplate(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return readFileSync(require.resolve('@wdf-dev/viewer/standalone.html'), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Standalone distribution profile (spec §9): one HTML file embedding the
 * package as base64 plus the full offline viewer. Falls back to a minimal
 * shell (notice + canonical `.wdf` re-extraction, §9.2) when the viewer has
 * not been built yet — e.g. tests running before the build.
 */
export function makeStandalone(wdfBytes: Uint8Array, title: string): string {
  const b64 = Buffer.from(wdfBytes).toString('base64');
  const template = loadViewerTemplate();
  if (template !== undefined) {
    return template
      .replaceAll('__WDF_TITLE__', () => escapeHtml(title))
      .replace('__WDF_PACKAGE_BASE64__', () => b64);
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — WDF</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>
      This is a WDF <em>standalone distribution file</em> (WDF Core 0.1 §9): the complete,
      verifiable document package is embedded below. The full offline viewer will be embedded in a
      future build; meanwhile you can retrieve the canonical package:
    </p>
    <p><a id="wdf-download" download="document.wdf" href="#">Download document.wdf</a></p>
    <script type="application/wdf+zip" id="wdf-package">${b64}</script>
    <script>
      (function () {
        var b64 = document.getElementById('wdf-package').textContent.trim();
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: 'application/wdf+zip' });
        document.getElementById('wdf-download').href = URL.createObjectURL(blob);
      })();
    </script>
  </body>
</html>
`;
}
