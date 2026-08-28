import { useQuery } from '@tanstack/react-query'
import { Activity, BarChart3, CalendarDays, CircleDollarSign, Loader2, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { lndryBrand } from '@/assets/generated/manifest'
import { apiGet } from '@/lib/api'
import { cn, formatINR } from '@/lib/utils'

type Period = 'today' | 'week' | 'lifetime'
type Statistics = {
  period: Period; from: string; to: string
  ordersReview: { total: number; breakdown: Array<{ state: string; count: number }>; daily: Array<{ date: string; orders: number; amount: number }> }
  revenue: { total: number; averageOrderValue: number }
  collection: { total: number; daily: Array<{ date: string; amount: number }> }
  customerFrequency: { total: number; repeatCustomers: number; breakdown: Array<{ customer: string; visits: number }> }
  newCustomer: { total: number; daily: Array<{ date: string; count: number }> }
  serviceMix: Array<{ service: string; quantity: number; amount: number }>
}

const palette = ['#3a7d78', '#e6bc65', '#8fc1b5', '#d86b4d', '#8797a0', '#6d5b96']

export default function LaundryStatistics() {
  const [period, setPeriod] = useState<Period>('week')
  const statistics = useQuery({ queryKey: ['laundry-statistics', period], queryFn: () => apiGet<Statistics>(`/laundry/statistics?period=${period}`) })
  const data = statistics.data
  const trend = useMemo(() => {
    if (!data) return []
    const collections = new Map(data.collection.daily.map((row) => [row.date, row.amount]))
    return data.ordersReview.daily.map((row) => ({ date: shortDate(row.date), orders: row.orders, revenue: row.amount, collection: collections.get(row.date) || 0 }))
  }, [data])
  if (statistics.isLoading) return <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div>
  if (statistics.isError || !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">Statistics could not be loaded.</div>

  const rangeLabel = period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Lifetime'
  return <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
    <div className="rounded-[26px] border border-[#263f44]/10 bg-gradient-to-br from-[#123039] via-[#1e5559] to-[#39786f] p-6 text-white shadow-[0_18px_45px_rgba(18,48,57,.18)] md:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/95 p-2 shadow-lg"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-contain" /></div><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#bfe4d8]">Laundry intelligence</p><h1 className="mt-1 font-serif text-3xl md:text-4xl">Overview</h1><p className="mt-2 max-w-xl text-sm text-white/75">A live pulse of orders, revenue, collections, customers and garment demand.</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-xl border border-white/20 bg-white/10 p-1 backdrop-blur-sm">{(['today', 'week', 'lifetime'] as Period[]).map((value) => <button key={value} type="button" onClick={() => setPeriod(value)} className={cn('rounded-lg px-3 py-2 text-xs font-bold transition', period === value ? 'bg-white text-[#123039]' : 'text-white/75 hover:bg-white/10')}>{value === 'today' ? 'Today' : value === 'week' ? 'Last 7 days' : 'Lifetime'}</button>)}</div><button type="button" onClick={() => void statistics.refetch()} className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20" aria-label="Refresh statistics"><RefreshCw className="h-4 w-4" /></button></div>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3 text-xs text-white/70"><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5"><Sparkles className="h-3.5 w-3.5 text-[#e6bc65]" />Demo-ready overview data</span><span>Range: {shortDate(data.from)} – {shortDate(data.to)}</span><span className="hidden sm:inline">·</span><span>Updated just now</span></div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Revenue" value={formatINR(data.revenue.total)} hint="Booked order value" icon={CircleDollarSign} accent="gold" />
      <StatCard label="Orders" value={String(data.ordersReview.total)} hint={`${rangeLabel} bookings`} icon={BarChart3} />
      <StatCard label="Collections" value={formatINR(data.collection.total)} hint="Submitted receipts" icon={CalendarDays} />
      <StatCard label="Avg. order" value={formatINR(data.revenue.averageOrderValue)} hint="Revenue per order" icon={Activity} />
      <StatCard label="Customers" value={String(data.customerFrequency.total)} hint={`${data.customerFrequency.repeatCustomers} repeat customers`} icon={UsersRound} />
      <StatCard label="New customers" value={String(data.newCustomer.total)} hint="Profiles created" icon={UsersRound} accent="gold" />
    </div>

    <Panel eyebrow="Performance" title="Revenue and collections" action={<span className="text-xs text-[#718087]">Orders · ₹ value</span>}><div className="h-72"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={trend} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}><defs><linearGradient id="overview-revenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3a7d78" stopOpacity={0.34} /><stop offset="100%" stopColor="#3a7d78" stopOpacity={0.03} /></linearGradient><linearGradient id="overview-collection" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e6bc65" stopOpacity={0.3} /><stop offset="100%" stopColor="#e6bc65" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8eeea" /><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis yAxisId="money" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} tickFormatter={(value) => `₹${value}`} /><YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip content={<PerformanceTooltip />} /><Area yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#3a7d78" strokeWidth={2.5} fill="url(#overview-revenue)" /><Area yAxisId="money" type="monotone" dataKey="collection" name="Collections" stroke="#d59e3b" strokeWidth={2} fill="url(#overview-collection)" /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#123039" radius={[4, 4, 0, 0]} barSize={14} /></ComposedChart></ResponsiveContainer></div><div className="mt-3 flex flex-wrap gap-4 text-xs text-[#718087]"><LegendDot color="#3a7d78" label="Revenue" /><LegendDot color="#d59e3b" label="Collections" /><LegendDot color="#123039" label="Orders" /></div></Panel>

    <div className="grid gap-5 xl:grid-cols-2">
      <Panel eyebrow="Orders review" title="Lifecycle mix"><div className="grid items-center gap-4 md:grid-cols-[180px_1fr]"><Donut rows={data.ordersReview.breakdown.map((row) => ({ name: row.state, value: row.count }))} /><Legend rows={data.ordersReview.breakdown.map((row) => ({ name: row.state, value: row.count }))} /></div></Panel>
      <Panel eyebrow="Customer frequency" title="Visits by customer"><div className="grid items-center gap-4 md:grid-cols-[180px_1fr]"><Donut rows={data.customerFrequency.breakdown.slice(0, 6).map((row) => ({ name: row.customer, value: row.visits }))} /><Legend rows={data.customerFrequency.breakdown.slice(0, 6).map((row) => ({ name: row.customer, value: row.visits }))} /></div></Panel>
      <Panel eyebrow="New customer" title="Acquisition trend"><Chart data={data.newCustomer.daily.map((row) => ({ date: shortDate(row.date), value: row.count }))} dataKey="value" /></Panel>
      <Panel eyebrow="Collection" title="Daily receipts"><Chart data={data.collection.daily.map((row) => ({ date: shortDate(row.date), value: row.amount }))} dataKey="value" currency /></Panel>
      <Panel eyebrow="Garment services" title="Service demand"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.serviceMix.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 8, left: 12, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e8eeea" /><XAxis type="number" hide /><YAxis type="category" dataKey="service" width={92} tick={{ fontSize: 10, fill: '#5e7074' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: unknown) => formatINR(Number(value || 0))} /><Bar dataKey="amount" name="Revenue" fill="#3a7d78" radius={[0, 5, 5, 0]} barSize={18}>{data.serviceMix.slice(0, 8).map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></div></Panel>
      <Panel eyebrow="Throughput" title="Orders by day"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.ordersReview.daily} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8eeea" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: unknown) => [String(value ?? 0), 'Orders']} /><Bar dataKey="orders" name="Orders" fill="#123039" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
    </div>
    <div className="flex flex-col gap-3 rounded-2xl border border-[#dbe8df] bg-[#f4faf5] px-5 py-4 text-xs text-[#5e7074] sm:flex-row sm:items-center sm:justify-between"><span><strong className="text-[#17353c]">Overview is powered by posted store records.</strong> Use Reports for invoice, balance, pickup and rider-level drill-downs.</span><Link to="/laundry/reports" className="font-bold text-[#39786f]">Open reports →</Link></div>
  </div>
}

function StatCard({ label, value, hint, icon: Icon, accent = 'teal' }: { label: string; value: string; hint: string; icon: typeof BarChart3; accent?: 'teal' | 'gold' }) { return <div className="rounded-[20px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><div className={cn('grid h-9 w-9 place-items-center rounded-xl', accent === 'gold' ? 'bg-[#fff6df] text-[#b47d19]' : 'bg-[#eaf5f0] text-[#3a7d78]')}><Icon className="h-4 w-4" /></div><p className="mt-4 text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 truncate font-serif text-2xl text-[#17353c]">{value}</p><p className="mt-1 text-[11px] text-[#74848a]">{hint}</p></div> }
function Panel({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) { return <section className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#4d8982]">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{title}</h2></div>{action}</div><div className="mt-5">{children}</div></section> }
function Donut({ rows }: { rows: Array<{ name: string; value: number }> }) { const chartRows = rows.length ? rows : [{ name: 'No data', value: 1 }]; return <div className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={3}>{chartRows.map((_, index) => <Cell key={index} fill={rows.length ? palette[index % palette.length] : '#dfe8e3'} />)}</Pie><Tooltip formatter={(value: unknown) => String(value ?? 0)} /></PieChart></ResponsiveContainer></div> }
function Legend({ rows }: { rows: Array<{ name: string; value: number }> }) { return <div className="space-y-2">{rows.length ? rows.map((row, index) => <div key={row.name} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2 text-[#4c6268]"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} /><span className="truncate">{row.name}</span></span><strong className="tabular-nums text-[#17353c]">{row.value}</strong></div>) : <p className="text-sm text-[#718087]">No records in this period.</p>}</div> }
function Chart({ data, dataKey, currency = false }: { data: Array<{ date: string; value: number }>; dataKey: string; currency?: boolean }) { return <div className="h-52"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><defs><linearGradient id={`stat-fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3a7d78" stopOpacity={0.28} /><stop offset="100%" stopColor="#3a7d78" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#7b8b8d' }} axisLine={false} tickLine={false} tickFormatter={(value) => currency ? `₹${value}` : value} /><Tooltip formatter={(value: unknown) => currency ? formatINR(Number(value || 0)) : String(value ?? 0)} /><Area type="monotone" dataKey={dataKey} stroke="#3a7d78" strokeWidth={2.5} fill={`url(#stat-fill-${dataKey})`} /></AreaChart></ResponsiveContainer></div> }
function PerformanceTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) { if (!active || !payload?.length) return null; return <div className="rounded-xl border border-[#dbe8df] bg-white px-3 py-2 text-xs shadow-lg"><p className="mb-1 font-bold text-[#17353c]">{label}</p>{payload.map((item) => <p key={item.name} className="flex justify-between gap-4 text-[#5e7074]"><span>{item.name}</span><strong style={{ color: item.color }}>{item.name === 'Orders' ? item.value : formatINR(Number(item.value || 0))}</strong></p>)}</div> }
function LegendDot({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span> }
function shortDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)) }
