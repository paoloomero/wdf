/**
 * Charset handling for imported HTML (plan §10.7, T7.1). Real-world Word
 * exports are frequently windows-1252 with a <meta> declaration; assuming
 * UTF-8 mangles every accented character. WHATWG TextDecoder knows all the
 * legacy labels, so no dependency is needed.
 */
export function decodeHtml(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  }

  // Sniff a charset declaration in the first 2 KiB (ASCII-compatible prefix).
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const declared = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._:-]+)/i.exec(head)?.[1];
  if (declared !== undefined && declared.toLowerCase() !== 'utf-8') {
    try {
      const decoder = new TextDecoder(declared);
      return { text: decoder.decode(bytes), encoding: decoder.encoding };
    } catch {
      // Unknown label: fall through to the generic path.
    }
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Not valid UTF-8 and no usable declaration: windows-1252 never throws
    // and is the de-facto fallback for legacy Word output.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
