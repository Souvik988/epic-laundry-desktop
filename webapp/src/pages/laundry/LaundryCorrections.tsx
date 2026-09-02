import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Printer, ShieldCheck } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { buildLaundryCorrectionPrintHtml, type PrintSettings } from '@/lib/laundryPrint'

type Correction = { id: string; customerId: string; orderId: string; claimId: string; garmentUnitId: string; decision: string; status: string; summary: string; customerMessage: string; issuedAt: string; issuedBy: string }

export default function LaundryCorrections() {
  const corrections = useQuery({ queryKey: ['customer-corrections'], queryFn: () => apiGet<Correction[]>('/laundry/customer-corrections') })
  if (corrections.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div>
  if (corrections.isError || !corrections.data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">Customer correction documents could not be loaded.</div>
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Customer care</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Correction documents</h1><p className="mt-1 max-w-2xl text-sm text-[#718087]">Every terminal quality decision creates one immutable, branch-scoped customer message. Print a branded copy for the counter handoff; the underlying claim and garment audit remain unchanged.</p></div><section className="overflow-hidden rounded-[24px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]"><header className="flex items-center gap-2 border-b border-[#263f44]/10 bg-[#fafaf7] p-5"><ShieldCheck className="h-5 w-5 text-[#39786f]" /><div><h2 className="font-serif text-xl text-[#17353c]">Issued corrections</h2><p className="text-xs text-[#718087]">{corrections.data.length} document{corrections.data.length === 1 ? '' : 's'} · read-only history</p></div></header>{corrections.data.length ? <div className="divide-y divide-[#263f44]/8">{corrections.data.map((correction) => <article key={correction.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#215861]">{correction.decision} · {correction.summary}</p><span className="rounded-full bg-[#eaf3ef] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#2e6a60]">{correction.status}</span></div><p className="mt-1 text-xs text-[#819095]">Customer {correction.customerId} · Order {correction.orderId} · Unit {correction.garmentUnitId}</p><p className="mt-2 max-w-3xl text-sm leading-6 text-[#52676b]">{correction.customerMessage}</p><p className="mt-2 text-[10px] uppercase tracking-[.1em] text-[#91a09f]">Issued {new Date(correction.issuedAt).toLocaleString('en-IN')} · {correction.issuedBy}</p></div><button type="button" onClick={() => void printCorrection(correction)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#39786f]/25 bg-white px-3 py-2.5 text-xs font-bold text-[#39786f] hover:bg-[#eaf3ef]"><Printer className="h-4 w-4" />Print copy</button></article>)}</div> : <div className="p-14 text-center text-sm text-[#718087]"><AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[#79a59b]" />No customer correction documents have been issued.</div>}</section></div>
}

async function printCorrection(correction: Correction) {
  const settings = await apiGet<PrintSettings>('/laundry/print-settings').catch(() => ({} as PrintSettings))
  const html = await buildLaundryCorrectionPrintHtml(correction, settings)
  if (window.epic?.printHtml) {
    const result = await window.epic.printHtml(html)
    try { await apiPost('/ops/hardware-receipts', { kind: 'receipt-printer', operation: 'print-correction', status: result.ok ? 'Completed' : 'Cancelled', device: 'electron-system-dialog', sourceEntity: 'laundry_customer_correction', sourceId: correction.id, evidence: result.ok ? 'Electron print callback reported success' : 'Operator cancelled the native print dialog' }) } catch (error) { console.warn('Correction print receipt could not be recorded', error) }
    return
  }
  const win = window.open('', '_blank', 'width=760,height=900'); if (!win) return
  try { win.opener = null } catch { /* browser may make opener read-only */ }
  win.document.write(`${html}<script>window.onload=()=>window.print()<\/script>`); win.document.close()
}
