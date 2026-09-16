// Common currencies covered by the free, keyless Frankfurter API (European Central Bank rates).
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'HKD',
  'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS', 'MXN', 'ZAR',
  'TRY', 'INR', 'KRW', 'BRL', 'THB', 'IDR', 'MYR', 'PHP', 'RON', 'BGN', 'ISK',
] as const;

const rateCache = new Map<string, number>();

async function fetchRate(from: string, to: string, bustCache: boolean): Promise<number> {
  // frankfurter.app now 301-redirects here; the redirect response itself has no CORS headers,
  // which browsers surface as an opaque "Failed to fetch" rather than following it cleanly.
  // Hitting the current domain directly avoids the redirect hop entirely.
  const cacheBuster = bustCache ? `&_=${Date.now()}` : '';
  const response = await fetch(`https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}${cacheBuster}`);
  if (!response.ok) throw new Error(`Could not fetch exchange rate for ${from} -> ${to}.`);

  const payload = await response.json();
  const rate = payload?.rates?.[to];
  if (typeof rate !== 'number') throw new Error(`No exchange rate available for ${from} -> ${to}.`);
  return rate;
}

/** Rate to multiply an amount in `from` by to get the equivalent in `to`. */
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  const cacheKey = `${from}_${to}`;
  const cached = rateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Frankfurter sits behind Cloudflare, which occasionally caches a stale response missing the
  // CORS header (e.g. from a non-browser client that hit the same URL without an Origin header).
  // That makes the browser reject an otherwise-200 response as a CORS violation. A cache-busting
  // retry forces a fresh request past that poisoned cache entry instead of failing outright.
  const rate = await fetchRate(from, to, false).catch(() => fetchRate(from, to, true));

  rateCache.set(cacheKey, rate);
  return rate;
}
