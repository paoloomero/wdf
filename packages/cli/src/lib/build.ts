import {
  computeHashes,
  extract,
  serializeHashes,
  serializeOutline,
  writePackage,
  WdfError,
  type WdfManifest,
} from '@wdf/core';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Builds a canonical package from source files (spec §3.4, plan T3.2):
 * content/ is the source of truth — ai/ and integrity/ are always
 * regenerated, never taken from the source directory.
 */
export async function buildPackage(source: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of source) {
    if (path.startsWith('ai/') || path.startsWith('integrity/')) continue;
    files.set(path, data);
  }

  const manifestBytes = files.get('manifest.json');
  if (manifestBytes === undefined) throw new WdfError('missing manifest.json', '§3.3.1');
  const manifest = JSON.parse(dec.decode(manifestBytes)) as WdfManifest;

  const entryBytes = files.get('content/index.html');
  if (entryBytes === undefined) throw new WdfError('missing content/index.html', '§3.3.1');

  const { markdown, outline } = extract(dec.decode(entryBytes));
  files.set('ai/content.md', enc.encode(markdown));
  files.set('ai/outline.json', enc.encode(serializeOutline(outline)));
  files.set('integrity/hashes.json', enc.encode(serializeHashes(await computeHashes(files))));

  return writePackage({ manifest, files });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Standalone distribution profile (spec §9): one HTML file embedding the
 * package as base64. PRELIMINARY shell — the full embedded viewer lands with
 * WP4 (T4.5); this version renders a notice and re-exposes the canonical
 * `.wdf` bytes (§9.2) so tooling can always round-trip.
 */
export function makeStandalone(wdfBytes: Uint8Array, title: string): string {
  const b64 = Buffer.from(wdfBytes).toString('base64');
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
