/**
 * Calendar dates for laundry operations are business-local dates, not UTC dates.
 * The default matches the Indian operating context; deployments can override it
 * with EPIC_TIME_ZONE (an Intl-supported IANA timezone).
 */
export const laundryTimeZone = () => process.env.EPIC_TIME_ZONE || 'Asia/Kolkata';

export function laundryBusinessDate(value = new Date(), timeZone = laundryTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
