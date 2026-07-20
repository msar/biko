/** A positioned text fragment from a PDF page (pdf.js item). */
export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
};

/**
 * Assemble left-to-right, top-to-bottom lines from pdf.js text items.
 * Sorts by x within each y-bin so scrambled content-stream order still reads correctly.
 */
export function assemblePdfTextLines(
  items: PdfTextItem[],
  opts?: { yBinSize?: number },
): string[] {
  const yBinSize = opts?.yBinSize ?? 1;
  const lineMap = new Map<number, Array<{ x: number; str: string }>>();

  for (const item of items) {
    const str = item.str?.trim() ? item.str : item.str;
    if (!str) continue;
    const y = Math.round(item.y / yBinSize) * yBinSize;
    const row = lineMap.get(y) ?? [];
    row.push({ x: item.x, str });
    lineMap.set(y, row);
  }

  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
  const lines: string[] = [];
  for (const y of sortedYs) {
    const row = (lineMap.get(y) ?? []).sort((a, b) => a.x - b.x);
    const joined = row
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined) lines.push(joined);
  }
  return lines;
}

export function assemblePdfText(items: PdfTextItem[], opts?: { yBinSize?: number }): string {
  return assemblePdfTextLines(items, opts).join('\n');
}
