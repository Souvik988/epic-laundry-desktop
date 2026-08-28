import { Minus, Plus, Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { LaundryCatalogue, LaundryOrder } from '@/lib/laundry'

export type EditableOrderLine = { garment: string; service: string; qty: string }

type Props = {
  order: LaundryOrder
  lines: EditableOrderLine[]
  setLines: Dispatch<SetStateAction<EditableOrderLine[]>>
  catalogue?: LaundryCatalogue
  loading: boolean
  failed: boolean
}

export default function OrderItemEditor({ order, lines, setLines, catalogue, loading, failed }: Props) {
  const labels = new Map(order.items.map((item, index) => [`${item.garment || ''}:${item.service || ''}`, `${item.garmentName} · ${item.serviceName}`]))
  for (const item of catalogue?.prices || []) labels.set(`${item.garment}:${item.service}`, `${item.garmentName} · ${item.serviceName}`)
  const prices = (catalogue?.prices || []).filter((price, index, rows) => rows.findIndex((row) => row.garment === price.garment && row.service === price.service) === index)
  const available = prices.filter((price) => !lines.some((line) => line.garment === price.garment && line.service === price.service))

  function update(index: number, change: Partial<EditableOrderLine>) {
    setLines((current) => current.map((line, row) => row === index ? { ...line, ...change } : line))
  }

  function remove(index: number) {
    setLines((current) => current.filter((_line, row) => row !== index))
  }

  function add() {
    const first = available[0]
    if (!first) return
    setLines((current) => [...current, { garment: first.garment, service: first.service, qty: '1' }])
  }

  return <div className="mt-2 space-y-2">
    <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#648077]">Garments and services</p>
    {lines.map((line, index) => {
      const value = `${line.garment}:${line.service}`
      const selectedLabel = labels.get(value) || 'Current garment/service'
      return <div key={`${value}:${index}`} className="grid grid-cols-[minmax(0,1fr)_64px_30px] items-center gap-2">
        <select aria-label={`Garment and service ${index + 1}`} value={value} onChange={(event) => { const [garment, service] = event.target.value.split(':'); update(index, { garment, service }) }} className="h-8 min-w-0 rounded-lg border border-[#39786f]/20 bg-white px-2 text-xs">
          {!catalogue && <option value={value}>{selectedLabel}</option>}
          {catalogue && !prices.some((price) => `${price.garment}:${price.service}` === value) && <option value={value}>{selectedLabel}</option>}
          {prices.map((price) => <option key={`${price.garment}:${price.service}`} value={`${price.garment}:${price.service}`}>{price.garmentName} · {price.serviceName} · ₹{price.rate}</option>)}
        </select>
        <input aria-label={`Quantity ${index + 1}`} type="number" min="0.01" step="0.01" value={line.qty} onChange={(event) => update(index, { qty: event.target.value })} className="h-8 w-full rounded-lg border border-[#39786f]/20 bg-white px-2 text-right text-xs" />
        <button type="button" aria-label={`Remove garment ${index + 1}`} onClick={() => remove(index)} disabled={lines.length <= 1} className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    })}
    {loading ? <p className="text-[10px] text-[#718087]">Loading available garments…</p> : failed ? <p className="text-[10px] text-rose-700">Additional garment options could not be loaded.</p> : <button type="button" onClick={add} disabled={!available.length} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#39786f]/30 px-2.5 py-1.5 text-[10px] font-bold text-[#39786f] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add garment or service</button>}
    <p className="flex items-center gap-1 text-[10px] leading-4 text-[#718087]"><Minus className="h-3 w-3" />Only unpaid orders without fulfilment events can be amended.</p>
  </div>
}
