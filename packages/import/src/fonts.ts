/**
 * Fonts extension (WP9, plan §10.19, docs/ext-fonts.md): when the imported
 * document's stacks reference a well-known proprietary family, embed its
 * metric-compatible open clone (the LibreOffice substitution table) and
 * prepend the clone to the stack — `"Carlito", "Calibri", sans-serif`.
 * Clones ship with the CLI as latin-subset woff2 (all OFL-1.1); consumers
 * that ignore the extension fall back to the stack exactly as before.
 */

/** Normalized source family → metric-compatible open clone. */
const SUBSTITUTES: Record<string, string> = {
  calibri: 'Carlito',
  cambria: 'Caladea',
  arial: 'Arimo',
  helvetica: 'Arimo',
  'times new roman': 'Tinos',
  times: 'Tinos',
  'courier new': 'Cousine',
  courier: 'Cousine',
};

const FACES: { weight: 400 | 700; style: 'normal' | 'italic' }[] = [
  { weight: 400, style: 'normal' },
  { weight: 400, style: 'italic' },
  { weight: 700, style: 'normal' },
  { weight: 700, style: 'italic' },
];

/**
 * Supplies the woff2 bytes for a face file name. The CLI reads them from the
 * files shipped in packages/cli/fonts/; a browser host would bundle them.
 */
export type FontReader = (fileName: string) => Uint8Array;

export interface EmbeddedFonts {
  /** The stylesheet with clone families prepended to matched stacks. */
  stylesheet: string;
  /** ext/fonts/* files: woff2 faces + fonts.css + fonts.json. */
  files: Map<string, Uint8Array>;
  report: string[];
}

function faceFileName(clone: string, weight: number, style: string): string {
  return `${clone.toLowerCase()}-latin-${String(weight)}-${style}.woff2`;
}

/**
 * Scans `font-family` declarations for substitutable families. Returns
 * undefined when nothing matches (no extension is produced). The first
 * substitutable family of each stack wins; its clone is prepended unless
 * already present.
 */
export function embedFonts(stylesheet: string, readFont: FontReader): EmbeddedFonts | undefined {
  const used = new Map<string, string>(); // clone → source family it substitutes
  const rewritten = stylesheet.replace(
    /(font-family:\s*)([^;\n]+)/g,
    (whole, prefix: string, value: string) => {
      const families = value.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
      for (const family of families) {
        const clone = SUBSTITUTES[family.toLowerCase()];
        if (clone === undefined) continue;
        if (families.some((f) => f.toLowerCase() === clone.toLowerCase())) return whole;
        used.set(clone, family);
        return `${prefix}"${clone}", ${value}`;
      }
      return whole;
    },
  );
  if (used.size === 0) return undefined;

  const files = new Map<string, Uint8Array>();
  const report: string[] = [];
  const faces: {
    family: string;
    substitutesFor: string;
    weight: number;
    style: string;
    path: string;
    license: string;
  }[] = [];
  for (const clone of [...used.keys()].sort()) {
    for (const { weight, style } of FACES) {
      const name = faceFileName(clone, weight, style);
      const path = `ext/fonts/${name}`;
      files.set(path, readFont(name));
      faces.push({
        family: clone,
        substitutesFor: used.get(clone) ?? '',
        weight,
        style,
        path,
        license: 'OFL-1.1',
      });
    }
    report.push(
      `embedded font "${clone}" (metric-compatible substitute for ${used.get(clone) ?? ''}, OFL-1.1, latin subset)`,
    );
  }

  const css = faces
    .map(
      (f) =>
        `@font-face {\n  font-family: "${f.family}";\n  font-style: ${f.style};\n  font-weight: ${String(f.weight)};\n  src: url("${f.path}") format("woff2");\n}`,
    )
    .join('\n');
  files.set('ext/fonts/fonts.css', new TextEncoder().encode(`${css}\n`));
  const meta = { fonts: '0.1', css: 'ext/fonts/fonts.css', faces };
  files.set('ext/fonts/fonts.json', new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`));
  return { stylesheet: rewritten, files, report };
}
