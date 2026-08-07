/**
 * Display-time aggregation of the conversion report (T15.2, plan §10.28): a
 * real web page can legitimately produce dozens of identical notes ("dropped
 * <button> …" ×42) that bury the informative ones. The raw report stays
 * intact — hosts aggregate only when presenting it. First-occurrence order
 * is preserved, so the narrative of the conversion is unchanged.
 */
export function aggregateReport(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    const n = counts.get(line) ?? 1;
    out.push(n > 1 ? `${line} (×${String(n)})` : line);
  }
  return out;
}
