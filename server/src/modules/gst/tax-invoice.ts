// GST tax-invoice print renderer (HTML). A signed IRP QR is rendered only when provider
// evidence is present; the not-yet-generated state never resembles a valid QR artifact.
// later a visual template designer (platform-core §7) replaces this.
import type { GstBreakdown } from './engine.js';

export function renderTaxInvoice(
  invoice: { name: string; posting_date: string; data: any },
  party: { name: string; gstin?: string; addr?: string },
  company: { gstin: string; name: string; addr: string; state: string },
  gst: GstBreakdown,
  einvoice?: { irn?: string; signedQr?: string; status?: string },
): string {
  const rows = gst.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td><td>${l.hsn}</td><td>${l.qty} ${l.unit}</td>
      <td class="r">${l.taxable.toFixed(2)}</td><td class="r">${l.gstRate}%</td>
      <td class="r">${l.cgst.toFixed(2)}</td><td class="r">${l.sgst.toFixed(2)}</td>
      <td class="r">${l.igst.toFixed(2)}</td><td class="r">${l.total.toFixed(2)}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Tax Invoice ${invoice.name}</title>
  <style>body{font:13px sans-serif;color:#111;padding:24px} h1{font-size:16px;margin:0}
  table{width:100%;border-collapse:collapse;margin-top:10px} th,td{border:1px solid #999;padding:4px 6px}
  .r{text-align:right} .box{border:1px solid #999;padding:10px;margin-top:12px}
  .qr{width:120px;height:120px;border:2px dashed #666;display:flex;align-items:center;justify-content:center;color:#888}</style></head>
  <body>
    <div style="display:flex;justify-content:space-between">
      <div><h1>${company.name}</h1><div>GSTIN: ${company.gstin}</div><div>${company.addr}</div></div>
      <div style="text-align:right"><h1>TAX INVOICE</h1><div>Invoice: <b>${invoice.name}</b></div><div>Dated: ${invoice.posting_date}</div></div>
    </div>
    <div class="box">Bill To: <b>${party.name}</b>${party.gstin ? ` (GSTIN: ${party.gstin})` : ' (Unregistered)'}<br>${party.addr || ''}</div>
    <table><thead><tr><th>#</th><th>HSN</th><th>Qty</th><th class="r">Taxable</th><th class="r">Rate</th>
      <th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="3">Total</th><th class="r">${gst.totalTaxable.toFixed(2)}</th><th></th>
      <th class="r">${gst.totalCgst.toFixed(2)}</th><th class="r">${gst.totalSgst.toFixed(2)}</th>
      <th class="r">${gst.totalIgst.toFixed(2)}</th><th class="r">${gst.grandTotal.toFixed(2)}</th></tr></tfoot></table>
    <div class="box" style="display:flex;gap:16px;align-items:center">
      ${einvoice?.signedQr
        ? `<img class="qr" src="${einvoice.signedQr}" alt="IRN QR"/>`
        : `<div class="qr" aria-label="Signed e-invoice QR is not available">No signed IRP QR<br>(not generated)</div>`}
      <div>IRN: <b>${einvoice?.irn || '(not generated)'}</b>${einvoice?.status ? ` [${einvoice.status}]` : ''}<br>
      Place of Supply: ${gst.posState} &nbsp;|&nbsp; ${gst.intraState ? 'Intra-state (CGST+SGST)' : 'Inter-state (IGST)'}<br>
      Total tax: ₹${gst.totalTax.toFixed(2)}</div>
    </div>
  </body></html>`;
}
