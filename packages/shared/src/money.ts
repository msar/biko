export type MoneyCurrency = 'ARS' | 'USD';

export function toArs(amount: number, exchangeRateToArs: number): number {
  return Math.round(amount * exchangeRateToArs * 100) / 100;
}

export function formatMoney(amount: number, currency: MoneyCurrency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(amount);
}

export function formatMoneyExact(amount: number, currency: MoneyCurrency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
  }).format(amount);
}

/** Known digital subscriptions that appear as USD on AR credit-card statements. */
const SUBSCRIPTION_MERCHANTS: Array<{ key: string; name: string; patterns: RegExp[] }> = [
  { key: 'spotify', name: 'Spotify', patterns: [/spotify/i] },
  { key: 'youtube', name: 'YouTube', patterns: [/youtube/i, /youtubep/i] },
  { key: 'netflix', name: 'Netflix', patterns: [/netflix/i] },
  { key: 'disney', name: 'Disney+', patterns: [/disney/i] },
  { key: 'apple', name: 'Apple', patterns: [/\bapple\b/i, /itunes/i, /icloud/i] },
  { key: 'amazon_prime', name: 'Amazon Prime', patterns: [/amazon\s*prime/i, /prime\s*video/i] },
  { key: 'openai', name: 'ChatGPT', patterns: [/openai/i, /chatgpt/i] },
  { key: 'instagram', name: 'Instagram', patterns: [/instagra/i] },
  { key: 'hbo', name: 'Max', patterns: [/\bhbo\b/i, /\bmax\b/i] },
  { key: 'paramount', name: 'Paramount+', patterns: [/paramount/i] },
];

export function detectSubscriptionMerchant(
  store: string,
): { key: string; name: string } | null {
  const text = store.trim();
  if (!text) return null;
  for (const m of SUBSCRIPTION_MERCHANTS) {
    if (m.patterns.some((re) => re.test(text))) {
      return { key: m.key, name: m.name };
    }
  }
  return null;
}
