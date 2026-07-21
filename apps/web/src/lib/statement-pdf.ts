import {
  assemblePdfTextLines,
  parseStatementText,
  type ParsedStatementLine,
  type StatementBankSource,
  bankFromEntityName,
} from '@biko/shared';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export { bankFromEntityName };

/** Strip MIME multipart wrappers some banks email as .pdf */
export function unwrapPdfBytes(bytes: Uint8Array): Uint8Array {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 512)));
  if (head.startsWith('%PDF-')) return bytes;
  const marker = '%PDF-';
  const text = new TextDecoder('latin1').decode(bytes);
  const start = text.indexOf(marker);
  if (start < 0) return bytes;
  const end = text.lastIndexOf('%%EOF');
  const slice = end > start ? text.slice(start, end + 5) : text.slice(start);
  const out = new Uint8Array(slice.length);
  for (let i = 0; i < slice.length; i++) out[i] = slice.charCodeAt(i) & 0xff;
  return out;
}

export async function extractPdfText(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const data = unwrapPdfBytes(buffer);
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      if (!('str' in item) || !item.str) return [];
      const transform = item.transform;
      return [
        {
          str: item.str,
          x: transform?.[4] ?? 0,
          y: transform?.[5] ?? 0,
        },
      ];
    });
    pageTexts.push(assemblePdfTextLines(items, { yBinSize: 1 }).join('\n'));
  }

  return pageTexts.join('\n\n');
}

export async function parseStatementPdf(
  file: File,
  bankHint?: StatementBankSource,
): Promise<{ bank: StatementBankSource; text: string; lines: ParsedStatementLine[] }> {
  const text = await extractPdfText(file);
  const parsed = parseStatementText(text, bankHint);
  return { bank: parsed.bank, text, lines: parsed.lines };
}

export function bankFromPaymentMethod(method: {
  definition: { entity: { name: string } | null };
}): StatementBankSource {
  return bankFromEntityName(method.definition.entity?.name);
}

/** Resolve parser bank hint from UI override + selected card.
 * Auto: detect from PDF text (card bank is only for guessing which card).
 */
export function resolveBankHint(
  override: StatementBankSource | 'Auto',
  _paymentMethod?: { definition: { entity: { name: string } | null } } | null | undefined,
): StatementBankSource | undefined {
  if (override !== 'Auto') return override;
  return undefined;
}

export function guessPaymentMethodId(
  text: string,
  methods: Array<{ id: string; lastFour: string | null; definition: { entity: { name: string } | null } }>,
): string | null {
  const digits = text.match(/\b(\d{4})\b/g)?.map((d) => d) ?? [];
  for (const m of methods) {
    if (m.lastFour && digits.includes(m.lastFour)) return m.id;
  }
  const lower = text.toLowerCase();
  for (const m of methods) {
    const entity = m.definition.entity?.name?.toLowerCase();
    if (entity && lower.includes(entity)) return m.id;
  }
  return methods.length === 1 ? methods[0]!.id : null;
}
