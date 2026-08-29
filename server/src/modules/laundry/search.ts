import { store } from '../../kernel/store.js';

export type LaundrySearchResult = {
  kind: 'customer' | 'order' | 'garment';
  id: string;
  label: string;
  detail: string;
  path: string;
};

type SearchAccess = { customers?: boolean; orders?: boolean; garments?: boolean };

/** Bounded, store-scoped global search. It returns navigational metadata only. */
export function searchLaundryWorkspace(tenant: string, query: unknown, access: SearchAccess = {}) {
  const term = String(query || '').trim().toLowerCase().slice(0, 80);
  if (term.length < 2) return [];
  const results: Array<LaundrySearchResult & { score: number }> = [];
  const add = (result: LaundrySearchResult, haystack: string) => {
    const index = haystack.indexOf(term);
    if (index < 0) return;
    results.push({ ...result, score: (index === 0 ? 20 : 0) + Math.max(0, 10 - index) });
  };
  if (access.customers !== false) {
    for (const row of store.rowsOf(tenant, 'party')) {
      const name = String(row.data.name || 'Unnamed customer');
      const phone = String(row.data.phone || '');
      const email = String(row.data.email || '');
      add({ kind: 'customer', id: row.id, label: name, detail: [phone, email].filter(Boolean).join(' · ') || 'Customer profile', path: `/laundry/customers/${encodeURIComponent(row.id)}` }, `${name} ${phone} ${email}`.toLowerCase());
    }
  }
  if (access.orders !== false) {
    for (const row of store.rowsOf(tenant, 'laundry_order')) {
      const orderNumber = String(row.data.order_number || row.id);
      const invoice = String(row.data.invoice_number || row.data.invoice || '');
      const customer = String(row.data.customer_name || row.data.customer || '');
      const state = String(row.data.state || row.status || '');
      add({ kind: 'order', id: row.id, label: orderNumber, detail: [customer, state, invoice].filter(Boolean).join(' · ') || 'Laundry order', path: `/laundry/orders?order=${encodeURIComponent(row.id)}` }, `${orderNumber} ${invoice} ${customer} ${row.id} ${state}`.toLowerCase());
    }
  }
  if (access.garments !== false) {
    for (const unit of store.listGarmentUnits(tenant)) {
      add({ kind: 'garment', id: unit.id, label: unit.activeTagCode || unit.code, detail: `${unit.garmentId} · ${unit.state} · ${unit.location}`, path: `/laundry/garment-tracking?tag=${encodeURIComponent(unit.activeTagCode)}` }, `${unit.activeTagCode} ${unit.code} ${unit.garmentId} ${unit.orderId} ${unit.state} ${unit.location}`.toLowerCase());
    }
  }
  return results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 30).map(({ score: _score, ...result }) => result);
}
