// Common currencies covered by the free, keyless Frankfurter API (European Central Bank rates).
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'HKD',
  'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS', 'MXN', 'ZAR',
  'TRY', 'INR', 'KRW', 'BRL', 'THB', 'IDR', 'MYR', 'PHP', 'RON', 'BGN', 'ISK',
] as const;

const rateCache = new Map<string, number>();

/** Rate to multiply an amount in `from` by to get the equivalent in `to`. */
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  const cacheKey = `${from}_${to}`;
  const cached = rateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  if (!response.ok) throw new Error(`Could not fetch exchange rate for ${from} -> ${to}.`);

  const payload = await response.json();
  const rate = payload?.rates?.[to];
  if (typeof rate !== 'number') throw new Error(`No exchange rate available for ${from} -> ${to}.`);

  rateCache.set(cacheKey, rate);
  return rate;
}
