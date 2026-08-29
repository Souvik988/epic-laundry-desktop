import { useQuery } from '@tanstack/react-query'
import { Loader2, Printer, Search, Tag } from 'lucide-react'
import { useState } from 'react'
import QRCode from 'qrcode'
import { apiGet, apiPost } from '@/lib/api'
import type { LaundryOrder } from '@/lib/laundry'
import { formatINR } from '@/lib/utils'
import { lndryBrand } from '@/assets/generated/manifest'

type Detail = LaundryOrder & { receipt: { items: Array<{ garmentName: string; serviceName: string; qty: number; amount: number }>; subtotal: number; charges: number; discounts: number; taxAmount: number; grandTotal: number }; tags: Array<{ tagNumber: string; orderNumber: string; customer: string; garment: string; service: string; sequence: number; total: number; orderDate: string; expectedDeliveryDate: string }> }
type PrintSettings = { businessName: string; address: string; phone: string; email: string; upiId: string; qrOnPrint: boolean; logoDataUrl: string }

export default function LaundryPrintCentre() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const orders = useQuery({ queryKey: ['print-centre-orders', search], queryFn: () => apiGet<LaundryOrder[]>(`/laundry/orders?search=${encodeURIComponent(search)}`) })
  const detail = useQuery({ queryKey: ['print-centre-order', selected], queryFn: () => apiGet<Detail>(`/laundry/orders/${selected}`), enabled: Boolean(selected) })
  const settings = useQuery({ queryKey: ['print-centre-settings'], queryFn: () => apiGet<PrintSettings>('/laundry/print-settings') })
  const order = detail.data
  const printSettings = settings.data
  const displayBusinessName = printSettings?.businessName?.trim() || 'Epic Laundry'
  const displayContact = [printSettings?.address, printSettings?.phone, printSettings?.email].filter(Boolean).join(' · ')
  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Print centre</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Invoices & garment tags</h1><p className="mt-1 text-sm text-[#718087]">Preview a controlled customer receipt or physical-unit tag sheet before printing.</p></div><div className="mt-6 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]"><section className="h-fit rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice or customer" className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#438b82]" /></div><div className="mt-3 max-h-[540px] space-y-1 overflow-y-auto">{orders.isLoading ? <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-[#3a7d78]" /> : (orders.data || []).map((row) => <button key={row.id} type="button" onClick={() => setSelected(row.id)} className={`w-full rounded-xl p-3 text-left transition ${selected === row.id ? 'bg-[#eaf3ef]' : 'hover:bg-[#f5f7f3]'}`}><span className="block text-sm font-bold text-[#205660]">{row.invoiceNumber || row.orderNumber}</span><span className="mt-0.5 block text-xs text-[#617178]">{row.customer.name} · {formatINR(row.grandTotal)}</span><span className="mt-1 block text-[10px] uppercase tracking-[.1em] text-[#829092]">{row.state}</span></button>)}{!orders.isLoading && !orders.data?.length && <p className="py-8 text-center text-sm text-[#718087]">No orders found.</p>}</div></section><section className="rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.05)] md:p-6">{!selected ? <div className="grid min-h-[440px] place-items-center text-center text-sm text-[#718087]"><Tag className="mx-auto mb-3 h-6 w-6 text-[#55938a]" />Select an order to preview its documents.</div> : detail.isLoading || !order ? <div className="grid min-h-[440px] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div> : <><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">Preview · {order.invoiceNumber || order.orderNumber}</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{order.customer.name}</h2></div><div className="flex gap-2"><button type="button" onClick={() => printDocument('receipt', order, printSettings)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#123039] px-3 py-2 text-xs font-bold text-white"><Printer className="h-3.5 w-3.5" />Receipt</button><button type="button" onClick={() => printDocument('tags', order, printSettings)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#e6bc65] px-3 py-2 text-xs font-bold text-[#17363e]"><Tag className="h-3.5 w-3.5" />Tags ({order.tags.length})</button></div></div><div className="mx-auto mt-6 max-w-xl rounded-xl border border-dashed border-[#9cb5ac] bg-white p-5"><div className="flex items-start justify-between gap-4 border-b border-[#263f44]/10 pb-4"><div><p className="font-serif text-xl text-[#17353c]">{displayBusinessName}</p><p className="mt-1 text-xs text-[#718087]">{order.fulfillmentMode} · Due {order.expectedDeliveryDate}</p>{displayContact ? <p className="mt-1 text-[10px] text-[#718087]">{displayContact}</p> : null}</div><img src={printSettings?.logoDataUrl || "/ui/app/brand/lndry-logo-source.png"} alt={`${displayBusinessName} logo`} className="h-10 w-10 object-contain" /></div><div className="mt-4 space-y-2">{order.receipt.items.map((item) => <div key={`${item.garmentName}:${item.serviceName}`} className="flex justify-between text-sm"><span>{item.garmentName} × {item.qty}<small className="ml-1 text-xs text-[#718087]">{item.serviceName}</small></span><strong>{formatINR(item.amount)}</strong></div>)}</div><div className="mt-4 space-y-1 border-t border-[#263f44]/10 pt-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatINR(order.receipt.subtotal)}</span></div><div className="flex justify-between"><span>Adjustments</span><span>{formatINR(order.receipt.charges - order.receipt.discounts + order.receipt.taxAmount)}</span></div><div className="mt-2 flex justify-between border-t border-[#263f44]/10 pt-2 font-serif text-xl"><span>Total</span><span>{formatINR(order.receipt.grandTotal)}</span></div></div><p className="mt-3 text-xs text-[#718087]">{order.paymentStatus} · {order.paymentMode} · {order.customer.phone}</p></div></>}</section></div></div>
}

async function printDocument(kind: 'receipt' | 'tags', order: Detail, printSettings?: PrintSettings) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  const settings = printSettings
  const configuredLogo = settings?.logoDataUrl?.startsWith('data:image/') ? settings.logoDataUrl : lndryBrand.mark
  const logo = configuredLogo.startsWith('data:image/') ? configuredLogo : await loadImageDataUrl(configuredLogo)
  const logoMarkup = logo ? `<img src="${logo}" alt="Lndry" class="brand-mark">` : '<span class="brand-fallback">Lndry</span>'
  const businessName = settings?.businessName?.trim() || 'Epic Laundry'
  const contact = [settings?.address, settings?.phone, settings?.email].filter(Boolean).map(escape).join(' · ')
  const upiQr = settings?.qrOnPrint && settings.upiId?.trim() ? await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(settings.upiId.trim())}&pn=${encodeURIComponent(businessName)}&cu=INR`, { width: 180, margin: 1, color: { dark: '#123039', light: '#ffffff' } }).catch(() => '') : ''
  const qrMarkup = upiQr ? `<div style="margin-left:auto;text-align:center"><img src="${upiQr}" alt="UPI payment QR" style="width:76px;height:76px;object-fit:contain"><small style="display:block;color:#718087">Scan to pay</small></div>` : ''
  const header = `<header>${logoMarkup}<div><strong>${escape(businessName)}</strong><small>Lndry · local laundry desk</small>${contact ? `<small>${contact}</small>` : ''}</div>${qrMarkup}</header>`
  const body = kind === 'receipt'
    ? `${header}<h1>Receipt</h1><p>${escape(order.invoiceNumber || order.orderNumber)} · ${escape(order.customer.name)} · ${escape(order.customer.phone)}</p><hr>${order.receipt.items.map((item) => `<p>${escape(item.garmentName)} × ${item.qty} — ${formatINR(item.amount)}</p>`).join('')}<hr><h2>Total: ${formatINR(order.receipt.grandTotal)}</h2><p>${escape(order.paymentStatus)} · ${escape(order.paymentMode)}</p>`
    : `${header}<h1>Garment tags</h1><p>${escape(order.orderNumber)} · ${escape(order.customer.name)} · Due ${escape(order.expectedDeliveryDate)}</p><div class="tags">${order.tags.map((tag) => `<article class="tag"><div class="tag-top"><strong>${escape(tag.tagNumber)}</strong><span>${escape(String(tag.sequence))} / ${escape(String(tag.total))}</span></div><strong>${escape(tag.garment)}</strong><small>${escape(tag.service)}</small><small>Customer: ${escape(tag.customer)}</small><small>Order date: ${escape(tag.orderDate)}</small><small>Due: ${escape(tag.expectedDeliveryDate)}</small></article>`).join('')}</div>`
  const html = `<!doctype html><html><head><title>${kind === 'receipt' ? 'Receipt' : 'Garment tags'} · Epic Laundry</title><style>body{font-family:Arial,sans-serif;color:#17353c;max-width:720px;margin:36px auto;padding:0 24px}header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #664cf0;padding-bottom:12px}header strong{display:block;font-size:24px}header small{display:block;color:#718087;margin-top:3px}.brand-mark{width:42px;height:42px;object-fit:contain}.brand-fallback{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#664cf0;color:white;font-weight:700}h1{font-size:24px}.tags{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.tag{border:1px dashed #78998f;border-radius:10px;padding:14px;min-height:110px;display:flex;flex-direction:column;gap:4px}.tag-top{display:flex;justify-content:space-between;gap:8px;color:#664cf0;font-size:12px}.tag small{color:#617178}@media print{button{display:none}}</style></head><body>${body}</body></html>`
  if (window.epic?.printHtml) {
    const result = await window.epic.printHtml(html)
    try { await apiPost('/ops/hardware-receipts', { kind: kind === 'receipt' ? 'receipt-printer' : 'tag-printer', operation: 'print', status: result.ok ? 'Completed' : 'Cancelled', device: 'electron-system-dialog', sourceEntity: 'laundry_order', sourceId: order.id, evidence: result.ok ? 'Electron print callback reported success' : 'Operator cancelled the native print dialog' }) } catch (error) { console.warn('Print receipt could not be recorded', error) }
    return
  }
  const win = window.open('', '_blank', 'width=800,height=900'); if (!win) return
  try { win.opener = null } catch { /* browser may make opener read-only */ }
  win.document.write(`${html}<script>window.onload=()=>window.print()<\/script>`); win.document.close()
}

async function loadImageDataUrl(source: string): Promise<string> {
  try {
    const response = await fetch(source)
    if (!response.ok) return ''
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}
