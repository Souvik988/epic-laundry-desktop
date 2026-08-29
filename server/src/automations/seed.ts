import { createHash } from 'node:crypto';
import { subscribe } from '../kernel/event-bus.js';
import { store } from '../kernel/store.js';
import { ShotlinXchatAdapter } from '../integrations/whatsapp/shotlinxchat.js';
import { audit } from '../kernel/audit.js';

// Phase-0 seed automation (docs/02-architecture/08-automation-engine.md):
// when a Sales Invoice is submitted, notify the customer on WhatsApp with a pay link.
// This is the "trigger -> condition -> action" pattern, human-facing (no ledger writes).
export function registerSeedAutomations(tenant: string) {
  const wa = new ShotlinXchatAdapter();

  subscribe('sales_invoice.submitted.v1', async (e) => {
    const p = e.payload as any;
    if (p.tenant && p.tenant !== tenant) return;
    if (p.suppress_notifications) {
      audit(tenant, 'automation', 'wa:skip-suppressed', { row_id: p.id });
      return;
    }
    const party = store.getRow(tenant, p.customer);
    const phone = party?.data?.phone;
    if (!phone) {
      audit(tenant, 'automation', 'wa:skip-no-phone', { row_id: p.id });
      return;
    }
    const base = process.env.EPIC_PUBLIC_BASE || 'http://localhost:3001';
    const link = `${base}/ui/invoice.html?id=${encodeURIComponent(p.id)}`;
    const msg =
      `Hello ${party.data.name},\nYour invoice *${p.name}* for ₹${p.grand_total} is ready.\n` +
      `View / pay: ${link}\nThank you!`;
    const res = await wa.sendText(phone, msg);
    const recipientHash = createHash('sha256').update(String(phone), 'utf8').digest('hex');
    audit(tenant, 'automation', 'wa:invoice-notify', {
      row_id: p.id,
      after: { recipientHash, recipientLength: String(phone).length, ok: res.ok, detail: res.detail },
    });
    console.log(`[automation] invoice ${p.name} -> WA recipientHash=${recipientHash} recipientLength=${String(phone).length}: ok=${res.ok} (${res.detail})`);
  });

  console.log('[automations] seed registered: sales_invoice.submitted -> WA notify');
}
