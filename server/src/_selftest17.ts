// Epic BOS self-test 17 — Phase-13 Distribution: customer portal + offline (PWA) assets.
// Uses Fastify's in-process inject() (no real socket) on an isolated store.
import { buildTest, closeTest, authH, j } from './_selftest_env.js';
process.env.EPIC_PORTAL_SECRET = 'portal-self-test-secret-012345678901234567890123';

let pass = 0; const fail: string[] = [];
const ok = (c: boolean, m: string) => { if (c) pass++; else fail.push(m); };

let app: any;
let sessionHeaders: Record<string, string> = authH().headers;

const req = async (method: string, url: string, body?: any) => {
  const r = await app.inject({
    method,
    url,
    headers: body ? { ...sessionHeaders, 'Content-Type': 'application/json' } : sessionHeaders,
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.statusCode, json: () => r.json(), text: () => r.body };
};
const post = async (entity: string, data: any) => (await req('POST', `/api/${entity}`, { data })).json();
const submit = async (entity: string, id: string) => req('POST', `/api/${entity}/${id}/submit`);

const seed = async () => {
  const cust = await post('party', { name: 'Portal Customer', gstin: '33AAAAA0000A1Z5', is_customer: true });
  const inv = await post('sales_invoice', { customer: cust.id, posting_date: '2026-01-10', place_of_supply: '33', items: [{ item: 'ITM-00001', qty: 2, rate: 100, gst_rate: 18 }] });
  await submit('sales_invoice', inv.id);
  const paid = await post('payment_entry', { payment_type: 'Receive', party: cust.id, against_sales: inv.id, amount: 100, mode: 'Bank', posting_date: '2026-01-15' });
  await submit('payment_entry', paid.id);
  return { cust, inv };
};

const main = async () => {
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'portal-owner', password: 'PortalOwnerPassword!26', tenant: 'T1', storeId: 'STORE-DEFAULT', businessName: 'Portal Test Laundry' } });
  sessionHeaders = { cookie: String(boot.headers['set-cookie']).split(';')[0] };
  const { cust, inv } = await seed();

  const tokenResponse = await req('POST', '/api/portal/access-token', { customerId: cust.id, ttlSeconds: 900 });
  ok(tokenResponse.status === 200, 'owner can issue a scoped portal token');
  const portalToken = tokenResponse.json().token;
  // Portal is read-only: a customer-bound token returns only that customer's open invoices + outstanding.
  const portal = j(await (await app.inject({ method: 'GET', url: `/api/portal/${cust.id}?token=${encodeURIComponent(portalToken)}` })).json());
  ok(portal.customer && portal.customer.name === 'Portal Customer', 'portal returns customer');
  ok(Array.isArray(portal.invoices) && portal.invoices.length === 1, 'portal lists open invoice');
  ok(portal.invoices[0].name === inv.data.name, 'portal invoice matches');
  ok(Math.abs(portal.invoices[0].balance - 136) < 0.01, 'portal balance = 236 - 100 = 136');
  ok(Math.abs(portal.total_outstanding - 136) < 0.01, 'portal total_outstanding = 136');
  ok((await app.inject({ method: 'GET', url: `/api/portal/${cust.id}` })).statusCode === 401, 'portal rejects an uncredentialed customer ID');

  // Read-only guarantee: a POST is rejected and GETs mutate nothing.
  const partiesBefore = (await (await req('GET', '/api/party')).json()).length;
  const postStatus = (await req('POST', `/api/portal/${cust.id}`, {})).status;
  ok(postStatus >= 400, 'portal rejects POST (read-only)');
  const partiesAfter = (await (await req('GET', '/api/party')).json()).length;
  ok(partiesAfter === partiesBefore, 'portal GET/POST did not create rows');

  // Offline (PWA) assets are served so the UI is installable / usable on mobile offline.
  const man = await req('GET', '/ui/manifest.webmanifest');
  ok(man.status === 200, 'manifest.webmanifest served');
  const sw = await req('GET', '/ui/sw.js');
  ok(sw.status === 200 && (await sw.text()).includes('caches'), 'sw.js served');

  if (fail.length) { console.log('FAIL:'); fail.forEach((f) => console.log(' -', f)); await closeTest(app); process.exit(1); }
  console.log(`_selftest17.ts : ALL PASS (${pass} assertions)`);
  await closeTest(app);
  process.exit(0);
};

app = await buildTest();
await main();
