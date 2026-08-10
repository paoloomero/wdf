// Fills the viewer's standalone template (spec §9, T15.1) — the same
// placeholder semantics as the CLI's makeStandalone (cli/src/lib/build.ts),
// re-implemented here because that one reads the template from the
// filesystem; the extension carries it in the bundle instead.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fillStandalone(template: string, title: string, wdfBase64: string): string {
  return template
    .replaceAll('__WDF_TITLE__', () => escapeHtml(title))
    .replace('__WDF_PACKAGE_BASE64__', () => wdfBase64);
}
