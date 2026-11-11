// usage: node pa.mjs <repoRoot> <dir-with-docx> <out.json>
// Per document: structure produced, validator verdict, conversion report
// (losses / changes / notes), and how much of the source text survives.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, dir, outPath] = process.argv.slice(2);
const imp = await import(pathToFileURL(`${root}/packages/import/dist/index.js`).href);
const core = await import(pathToFileURL(`${root}/packages/core/dist/index.js`).href);
const dec = new TextDecoder();
const words = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const bag = (list) => {
  const m = new Map();
  for (const w of list) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};
function sourceText(c, part) {
  let xml = c.partText(part) ?? '';
  // A text box is written twice (mc:Choice + mc:Fallback): count it once.
  xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
  // Runs of one paragraph join with no space (words are split across runs);
  // paragraphs, tabs and breaks separate words. Deleted text is not w:t.
  let text = '';
  for (const m of xml.matchAll(
    /<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br\b[^>]*\/>|<w:tc>|<w:cr\/>/g,
  ))
    text += m[1] ?? ' ';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
const out = [];
for (const name of readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.docx'))
  .sort()) {
  const rec = { file: name };
  try {
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    rec.bytes = bytes.length;
    const c = imp.openDocx(bytes);
    const main = c.mainDocumentPart();
    const parts = c.partNames();
    rec.src = {
      tables: (c.partText(main).match(/<w:tbl>/g) ?? []).length,
      images: parts.filter((p) => /^word\/media\//.test(p)).length,
      footnotes: Math.max(
        0,
        ((c.partText('word/footnotes.xml') ?? '').match(/<w:footnote /g) ?? []).length - 2,
      ),
      headersFooters: parts.filter((p) => /^word\/(header|footer)\d*\.xml$/.test(p)).length,
      textboxes: (c.partText(main).match(/<w:txbxContent>/g) ?? []).length,
    };
    const report = [];
    const result = await imp.importDocument(
      { kind: 'docx', bytes, baseName: name.replace(/\.docx$/i, ''), sourceName: name },
      { date: '2026-01-01T00:00:00Z', withSource: true },
      report,
    );
    if (result === undefined) {
      rec.empty = true;
      out.push(rec);
      continue;
    }
    const v = await core.validatePackage(result.wdfBytes);
    rec.verified = v.verified;
    rec.status = v.status;
    rec.errors = v.violations
      .filter((x) => x.severity === 'error')
      .map((x) => `[${x.spec}] ${x.message}`);
    rec.warnings = v.violations
      .filter((x) => x.severity === 'warning')
      .map((x) => `[${x.spec}] ${x.message}`);
    const html = result.html;
    const count = (t) => (html.match(new RegExp(`<${t}[\\s>]`, 'g')) ?? []).length;
    rec.out = Object.fromEntries(
      [
        'h1',
        'h2',
        'h3',
        'h4',
        'p',
        'ul',
        'ol',
        'li',
        'table',
        'tr',
        'img',
        'figure',
        'sup',
        'header',
        'footer',
      ].map((t) => [t, count(t)]),
    );
    rec.report = imp.aggregateReport(report);
    const pkg = core.readPackage(result.wdfBytes);
    const md = dec.decode(pkg.files.get('ai/content.md'));
    rec.mdChars = md.length;
    // text coverage: body + notes of the source against the AI layer (multiset of words)
    const srcWords = words(
      [main, 'word/footnotes.xml', 'word/endnotes.xml'].map((p) => sourceText(c, p)).join(' '),
    );
    const mdBag = bag(words(md.replace(/\{#[^}]*\}/g, ' ')));
    let kept = 0;
    const missing = new Map();
    for (const w of srcWords) {
      const n = mdBag.get(w) ?? 0;
      if (n > 0) {
        kept++;
        mdBag.set(w, n - 1);
      } else missing.set(w, (missing.get(w) ?? 0) + 1);
    }
    rec.srcWords = srcWords.length;
    rec.keptWords = kept;
    rec.coverage = srcWords.length === 0 ? 1 : kept / srcWords.length;
    rec.missingTop = [...missing].sort((a, b) => b[1] - a[1]).slice(0, 12);
  } catch (e) {
    rec.crash = String(e?.message ?? e).slice(0, 200);
  }
  out.push(rec);
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
for (const r of out)
  console.log(
    r.file.slice(0, 44).padEnd(44),
    r.crash
      ? 'CRASH ' + r.crash
      : r.empty
        ? 'EMPTY'
        : `${r.verified ? 'VALID' : 'INVALID'} err ${r.errors.length} warn ${r.warnings.length} | text ${(r.coverage * 100).toFixed(1)}% of ${r.srcWords} words | notes ${r.report.length}`,
  );
