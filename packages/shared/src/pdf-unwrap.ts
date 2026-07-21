/** Find first index of ASCII needle in bytes, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: string): number {
  const n = needle.length;
  if (n === 0 || n > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - n; i++) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function lastIndexOfBytes(haystack: Uint8Array, needle: string): number {
  const n = needle.length;
  if (n === 0 || n > haystack.length) return -1;
  outer: for (let i = haystack.length - n; i >= 0; i--) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Strip MIME multipart wrappers some banks email as .pdf.
 * Must stay binary-safe: TextDecoder('latin1') is windows-1252 in browsers and
 * corrupts Flate streams (e.g. 0x9C → 0x53 → Bad FCHECK).
 */
export function unwrapPdfBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 5 && indexOfBytes(bytes.subarray(0, 5), '%PDF-') === 0) {
    return bytes;
  }
  const start = indexOfBytes(bytes, '%PDF-');
  if (start < 0) return bytes;
  const end = lastIndexOfBytes(bytes, '%%EOF');
  // Include %%EOF (5) plus a trailing newline if present — pdf.js accepts either.
  let endExclusive = end > start ? end + 5 : bytes.length;
  if (endExclusive < bytes.length && (bytes[endExclusive] === 0x0a || bytes[endExclusive] === 0x0d)) {
    endExclusive += 1;
    if (
      endExclusive < bytes.length &&
      bytes[endExclusive - 1] === 0x0d &&
      bytes[endExclusive] === 0x0a
    ) {
      endExclusive += 1;
    }
  }
  return bytes.subarray(start, endExclusive);
}
