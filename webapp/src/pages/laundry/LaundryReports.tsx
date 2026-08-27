import { useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarDays, CircleDollarSign, Download, Loader2, Printer, RefreshCw, Scissors, Shirt, Users, WalletCards } from 'lucide-react'
import { useState } from 'react'
import { apiGet } from '@/lib/api'
import { formatINR } from '@/lib/utils'

type TrendPoint = { date: string; orders: number; orderValue: number; collected: number; expenses: number }
type RankedItem = { name: string; quantity: number; amount: number }
type Reports = {
  summary: { orderValue: number; collected: number; outstanding: number; expenses: number; operatingCash: number; orders: number; customers: number }
  stateBreakdown: Array<{ state: string; count: number; amount: number }>
  paymentBreakdown: Array<{ paymentMode: string; count: number; amount: number }>
  trend: TrendPoint[]
  fulfillmentBreakdown: Array<{ mode: string; count: number; amount: number }>
  topGarments: RankedItem[]
  topServices: RankedItem[]
}

export default function LaundryReports() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const report = useQuery({ queryKey: ['laundry-reports', from, to], queryFn: () => apiGet<Reports>(`/laundry/reports?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`) })
  const data = report.data

  if (report.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div>
  if (report.isError || !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">Reports could not be loaded.</div>

  const maxTrend = Math.max(...data.trend.map((point) => point.orderValue), 1)
  const maxFulfilment = Math.max(...data.fulfillmentBreakdown.map((row) => row.count), 1)
  const maxGarment = Math.max(...data.topGarments.map((row) => row.amount), 1)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Performance ledger</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Reports</h1><p className="mt-1 text-sm text-[#718087]">Collections, order value, payments, and posted store expenses.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[#617178]">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 font-normal" /></label>
          <label className="text-xs font-semibold text-[#617178]">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block h-9 rounded-lg border border-[#263f44]/15 bg-white px-2 font-normal" /></label>
          <button type="button" onClick={() => { setFrom(''); setTo('') }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57]"><RefreshCw className="h-3.5 w-3.5" />Reset</button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#263f44]/15 bg-white px-3 text-xs font-bold text-[#315d57]"><Printer className="h-3.5 w-3.5" />Print / PDF</button>
          <button type="button" onClick={() => void exportReport(data)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#123039] px-3 text-xs font-bold text-white"><Download className="h-3.5 w-3.5" />Excel</button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Order value" value={formatINR(data.summary.orderValue)} icon={BarChart3} hint={`${data.summary.orders} orders in range`} />
        <Metric label="Collected" value={formatINR(data.summary.collected)} icon={CircleDollarSign} hint={`${formatINR(data.summary.outstanding)} outstanding`} />
        <Metric label="Store expenses" value={formatINR(data.summary.expenses)} icon={WalletCards} hint="Posted operating costs" />
        <Metric label="Operating cash" value={formatINR(data.summary.operatingCash)} icon={Users} hint={`${data.summary.customers} customers served`} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
        <div className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6">
          <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">Business overview</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">Revenue & collection</h2></div><span className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf3ef] px-2.5 py-1 text-[11px] font-bold text-[#32695f]"><CalendarDays className="h-3.5 w-3.5" />{rangeLabel(data.trend)}</span></div>
          <div className="mt-6 flex h-48 items-end gap-2 border-b border-[#263f44]/10 pb-0 sm:gap-3" role="img" aria-label="Daily order value and collection bar chart">
            {data.trend.map((point) => <div key={point.date} className="group flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${point.date}: ${formatINR(point.orderValue)} order value, ${formatINR(point.collected)} collected`}><div className="w-2.5 rounded-t-md bg-[#8fc1b5] transition-all group-hover:bg-[#6aa99b] sm:w-4" style={{ height: `${Math.max(4, point.orderValue / maxTrend * 100)}%` }} /><div className="w-2.5 rounded-t-md bg-[#e6bc65] transition-all group-hover:bg-[#d9a94b] sm:w-4" style={{ height: `${Math.max(4, point.collected / maxTrend * 100)}%` }} /></div>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[10px] font-semibold text-[#7b8b8d]">{data.trend.map((point) => <span key={point.date}>{shortDate(point.date)}</span>)}</div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-[#5d7073]"><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#8fc1b5]" />Order value</span><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#e6bc65]" />Collected</span></div>
        </div>
        <div className="rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">Fulfilment mix</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">How orders leave</h2><div className="mt-6 space-y-4">{data.fulfillmentBreakdown.length ? data.fulfillmentBreakdown.map((row) => <div key={row.mode}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-[#315d57]">{row.mode}</span><span className="font-bold tabular-nums text-[#17353c]">{row.count}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e4ebe5]"><div className="h-full rounded-full bg-[#3a7d78]" style={{ width: `${row.count / maxFulfilment * 100}%` }} /></div><p className="mt-1 text-xs text-[#77878a]">{formatINR(row.amount)} order value</p></div>) : <p className="py-10 text-center text-sm text-[#718087]">No fulfilment data in this range.</p>}</div></div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2"><Breakdown title="Order lifecycle" headers={['State', 'Orders', 'Value']} rows={data.stateBreakdown.map((row) => [row.state, String(row.count), formatINR(row.amount)])} /><Breakdown title="Payment mix" headers={['Method', 'Orders', 'Value']} rows={data.paymentBreakdown.map((row) => [row.paymentMode, String(row.count), formatINR(row.amount)])} /></section>

      <section className="grid gap-5 xl:grid-cols-2"><Ranking title="Top garments" icon={Shirt} rows={data.topGarments} max={maxGarment} /><Ranking title="Top services" icon={Scissors} rows={data.topServices} max={Math.max(...data.topServices.map((row) => row.amount), 1)} /></section>

      <div className="rounded-[22px] bg-[#123039] p-5 text-[#edf3ec] md:p-6"><p className="text-xs uppercase tracking-[.16em] text-[#b8d3c8]">Customer & balance snapshot</p><div className="mt-3 flex flex-wrap gap-x-10 gap-y-3"><span><strong className="font-serif text-2xl text-[#f1ca75]">{data.summary.orders}</strong><span className="ml-2 text-sm">orders in range</span></span><span><strong className="font-serif text-2xl text-[#f1ca75]">{data.summary.customers}</strong><span className="ml-2 text-sm">customers served</span></span><span><strong className="font-serif text-2xl text-[#f1ca75]">{formatINR(data.summary.outstanding)}</strong><span className="ml-2 text-sm">outstanding</span></span></div></div>
    </div>
  )
}

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof BarChart3 }) { return <div className="rounded-[20px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><Icon className="h-5 w-5 text-[#3a7d78]" /><p className="mt-4 text-xs font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 font-serif text-3xl text-[#17353c]">{value}</p><p className="mt-1 text-xs text-[#74848a]">{hint}</p></div> }

function Breakdown({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) { return <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]"><h2 className="border-b border-[#263f44]/10 p-5 font-serif text-xl text-[#17353c]">{title}</h2><table className="w-full text-left text-sm"><thead className="bg-[#fafaf7] text-[10px] font-bold uppercase tracking-[.14em] text-[#718087]"><tr>{headers.map((header) => <th key={header} className="px-5 py-3">{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]} className="border-t border-[#263f44]/8">{row.map((cell, index) => <td key={index} className="px-5 py-3.5"><span className={index === 2 ? 'font-bold tabular-nums' : ''}>{cell}</span></td>)}</tr>)}</tbody></table></section> }

function Ranking({ title, rows, max, icon: Icon }: { title: string; rows: RankedItem[]; max: number; icon: typeof Shirt }) { return <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf3ef] text-[#3a7d78]"><Icon className="h-4 w-4" /></span><h2 className="font-serif text-xl text-[#17353c]">{title}</h2></div><div className="mt-5 space-y-4">{rows.length ? rows.map((row) => <div key={row.name}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-[#315d57]">{row.name}</span><span className="font-bold tabular-nums text-[#17353c]">{formatINR(row.amount)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e4ebe5]"><div className="h-full rounded-full bg-[#8fc1b5]" style={{ width: `${row.amount / max * 100}%` }} /></div><p className="mt-1 text-xs text-[#77878a]">{row.quantity} units processed</p></div>) : <p className="py-8 text-center text-sm text-[#718087]">No records in this range.</p>}</div></section> }

function shortDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)) }
function rangeLabel(points: TrendPoint[]) { if (!points.length) return 'No dates'; return `${shortDate(points[0].date)} – ${shortDate(points[points.length - 1].date)}` }
async function exportReport(data: Reports) { const XLSX = await import('xlsx'); const sheet = XLSX.utils.json_to_sheet(data.trend.map((point) => ({ Date: point.date, Orders: point.orders, 'Order value': point.orderValue, Collected: point.collected, Expenses: point.expenses }))); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Business overview'); XLSX.writeFile(workbook, `laundry-report-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true }) }
