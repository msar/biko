import { describe, expect, it } from 'vitest';
import { unwrapPdfBytes } from './pdf-unwrap';

describe('unwrapPdfBytes', () => {
  it('returns plain PDFs unchanged', () => {
    const pdf = Uint8Array.from('%PDF-1.4\n...\n%%EOF\n', (c) => c.charCodeAt(0));
    expect(unwrapPdfBytes(pdf)).toBe(pdf);
  });

  it('extracts embedded PDF from MIME without corrupting high bytes', () => {
    // 0x78 0x9C is a valid zlib header; windows-1252 latin1 decode would turn 0x9C into 0x53.
    const zlib = Uint8Array.of(0x78, 0x9c, 0xdd, 0x98, 0x80, 0x9c, 0x92);
    const mime = new Uint8Array([
      ...Uint8Array.from('------=_Part\r\nContent-Type: application/pdf\r\n\r\n', (c) =>
        c.charCodeAt(0),
      ),
      ...Uint8Array.from('%PDF-1.4\nstream\n', (c) => c.charCodeAt(0)),
      ...zlib,
      ...Uint8Array.from('\nendstream\n%%EOF\n\r\n------=_Part--\r\n', (c) => c.charCodeAt(0)),
    ]);

    const out = unwrapPdfBytes(mime);
    expect(String.fromCharCode(...out.subarray(0, 8))).toBe('%PDF-1.4');
    expect(indexOf(out, '%%EOF')).toBeGreaterThan(0);
    // zlib header preserved (would become 120,83 under windows-1252 "latin1")
    const streamIdx = indexOf(out, 'stream\n');
    expect(streamIdx).toBeGreaterThan(0);
    expect([...out.subarray(streamIdx + 7, streamIdx + 9)]).toEqual([0x78, 0x9c]);
    expect([...out].filter((b) => b === 0x9c).length).toBe(2);
  });
});

function indexOf(buf: Uint8Array, str: string): number {
  const n = str.length;
  outer: for (let i = 0; i <= buf.length - n; i++) {
    for (let j = 0; j < n; j++) if (buf[i + j] !== str.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
