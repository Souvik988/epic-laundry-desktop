/**
 * Money boundary for the laundry domain. Values are normalized to integer
 * paise before they enter persistence or arithmetic. Internal presentation may
 * still use numbers, but only values representable to two decimal places cross
 * an operator/API boundary.
 */
export function parseMoney(value: unknown, label = 'amount', options: { allowNegative?: boolean; allowZero?: boolean } = {}) {
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? value.toString() : '') : String(value ?? '').trim();
  if (!raw || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label} must be a valid amount with at most two decimal places`);
  const negative = raw.startsWith('-');
  if (negative && !options.allowNegative) throw new Error(`${label} cannot be negative`);
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const paise = (Number(whole) * 100) + Number(fraction.padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(paise)) throw new Error(`${label} is outside the supported money range`);
  const signed = negative ? -paise : paise;
  if (!options.allowZero && signed === 0) throw new Error(`${label} must be greater than zero`);
  return signed;
}

export const moneyNumber = (paise: number) => paise / 100;
export const optionalMoney = (value: unknown, label = 'amount') => value === undefined || value === null || value === '' ? 0 : moneyNumber(parseMoney(value, label, { allowZero: true }));
