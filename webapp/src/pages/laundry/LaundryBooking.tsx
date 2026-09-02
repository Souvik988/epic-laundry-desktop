import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, CircleDollarSign, Download, ImagePlus, Loader2, Minus, PackagePlus, Pause, PlayCircle, Plus, Printer, RotateCcw, Search, Tag, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost, apiPostOffline } from '@/lib/api'
import { garmentVisuals } from '@/assets/generated/manifest'
import type { LaundryCatalogue, LaundryQuote } from '@/lib/laundry'
import { cn, formatINR, localDateKey } from '@/lib/utils'
import { buildLaundryPrintHtml, type PrintOrder, type PrintSettings } from '@/lib/laundryPrint'

type CartLine = { garment: string; service: string; qty: number }
type Customer = { id: string; name: string; phone: string; email?: string; address?: string }
type Receipt = { orderNumber: string; invoiceNumber?: string; customer: { name: string; phone: string }; orderDate: string; expectedDeliveryDate: string; fulfillmentMode: string; items: LaundryQuote['items']; subtotal: number; charges: number; discounts: number; taxAmount: number; grandTotal: number; paymentMode: string; paymentStatus: string }
type TagData = { tagNumber: string; containerId?: string; tagKind?: 'garment' | 'container'; orderNumber: string; customer: string; garment: string; service: string; sequence: number; total: number; orderDate: string; expectedDeliveryDate: string; weightKg?: number }
type BookingResult = { order?: { id: string; orderNumber: string }; receipt: Receipt; tags: TagData[]; containerTags?: TagData[] }
type BookingDraft = { cart: Record<string, CartLine>; customer: Customer | null; newCustomerName: string; newCustomerPhone: string; deliveryAddress: string; serviceZone: string; containerCount?: number; deliveryMode: 'Pickup Order' | 'Home Delivery' | 'Express Delivery'; expectedDeliveryDate: string; charges: number; discounts: number; taxRate: number; chargeRuleIds: string[]; discountRuleIds: string[]; taxRuleId: string; notes: string }
type HeldDraft = BookingDraft & { id: string; savedAt: string; paymentMode: 'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank'; paymentReference: string; serverHoldId?: string; holdCode?: string; ownership?: 'mine' | 'other' | 'expired' | 'unassigned' }
type ServerHold = { id: string; holdCode: string; status: 'Held' | 'Resumed' | 'Cancelled'; payload: HeldDraft; createdAt: string; ownership: 'mine' | 'other' | 'expired' | 'unassigned'; leaseExpiresAt?: string }
type HoldPresence = { leaseMinutes: number; totalHeld: number; mineActive: number; otherActive: number; expired: number; unassigned: number }
type RepeatOrder = { items: CartLine[]; fulfillmentMode?: 'Pickup Order' | 'Home Delivery' | 'Express Delivery'; serviceZone?: string; deliveryAddress?: string; notes?: string }
const DRAFT_KEY = 'epic-laundry-booking-draft-v1'
const HELD_DRAFTS_KEY = 'epic-laundry-held-drafts-v1'

export default function LaundryBooking() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [serviceZone, setServiceZone] = useState('')
  const [containerCount, setContainerCount] = useState('')
  const [photoPath, setPhotoPath] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [category, setCategory] = useState('all')
  const [service, setService] = useState('all')
  const [garmentSearch, setGarmentSearch] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<'Pickup Order' | 'Home Delivery' | 'Express Delivery'>('Home Delivery')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(defaultDeliveryDate())
  const [paymentMode, setPaymentMode] = useState<'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank'>('Pay Later')
  const [cashRegister, setCashRegister] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [charges, setCharges] = useState(0)
  const [discounts, setDiscounts] = useState(0)
  const [taxRate, setTaxRate] = useState(0)
  const [chargeRuleIds, setChargeRuleIds] = useState<string[]>([])
  const [discountRuleIds, setDiscountRuleIds] = useState<string[]>([])
  const [taxRuleId, setTaxRuleId] = useState('')
  const [notes, setNotes] = useState('')
  const [receipt, setReceipt] = useState<BookingResult | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [heldDrafts, setHeldDrafts] = useState<HeldDraft[]>([])
  const [repeatPending, setRepeatPending] = useState(false)
  const [repeatNotice, setRepeatNotice] = useState('')
  const cashShifts = useQuery({ queryKey: ['laundry-cash-shifts'], queryFn: () => apiGet<Array<{ id: string; status: string; register: string }>>('/laundry/cash-shifts'), enabled: paymentMode === 'Cash', retry: false })
  const printSettings = useQuery({ queryKey: ['laundry-booking-print-settings'], queryFn: () => apiGet<PrintSettings>('/laundry/print-settings'), retry: false })
  const serverHolds = useQuery({ queryKey: ['laundry-order-holds'], queryFn: () => apiGet<ServerHold[]>('/laundry/order-holds'), retry: false })
  const holdPresence = useQuery({ queryKey: ['laundry-order-hold-presence'], queryFn: () => apiGet<HoldPresence>('/laundry/order-holds/presence'), retry: false, refetchInterval: 30_000 })
  const resumeServerHold = useMutation({ mutationFn: (id: string) => apiPost<ServerHold>(`/laundry/order-holds/${id}/resume`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] }) })
  const claimServerHold = useMutation({ mutationFn: (id: string) => apiPost<ServerHold>(`/laundry/order-holds/${id}/claim`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] }) })

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null') as Partial<BookingDraft> | null
      if (parsed) {
        if (parsed.cart && typeof parsed.cart === 'object') setCart(parsed.cart as Record<string, CartLine>)
        if (parsed.customer) setCustomer(parsed.customer)
        if (typeof parsed.newCustomerName === 'string') setNewCustomerName(parsed.newCustomerName)
        if (typeof parsed.newCustomerPhone === 'string') setNewCustomerPhone(parsed.newCustomerPhone)
        if (typeof parsed.deliveryAddress === 'string') setDeliveryAddress(parsed.deliveryAddress)
        if (typeof parsed.serviceZone === 'string') setServiceZone(parsed.serviceZone)
        if (typeof parsed.containerCount === 'number') setContainerCount(String(parsed.containerCount))
        if (parsed.deliveryMode) setDeliveryMode(parsed.deliveryMode)
        if (typeof parsed.expectedDeliveryDate === 'string') setExpectedDeliveryDate(parsed.expectedDeliveryDate)
        if (typeof parsed.charges === 'number') setCharges(parsed.charges)
        if (typeof parsed.discounts === 'number') setDiscounts(parsed.discounts)
        if (typeof parsed.taxRate === 'number') setTaxRate(parsed.taxRate)
        if (Array.isArray(parsed.chargeRuleIds)) setChargeRuleIds(parsed.chargeRuleIds)
        if (Array.isArray(parsed.discountRuleIds)) setDiscountRuleIds(parsed.discountRuleIds)
        if (typeof parsed.taxRuleId === 'string') setTaxRuleId(parsed.taxRuleId)
        if (typeof parsed.notes === 'string') setNotes(parsed.notes)
      }
    } catch { /* a corrupt draft is ignored and replaced by the next save */ }
    try {
      const held = JSON.parse(window.localStorage.getItem(HELD_DRAFTS_KEY) || '[]')
      if (Array.isArray(held)) setHeldDrafts(held.slice(0, 10) as HeldDraft[])
    } catch { /* corrupt held drafts are ignored */ }
    setDraftRestored(true)
  }, [])
  useEffect(() => {
    if (!draftRestored) return
    const draft: BookingDraft = { cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount: containerCount === '' ? undefined : Number(containerCount), deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* local storage is best effort */ }
  }, [draftRestored, cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount, deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes])
  useEffect(() => {
    if (!serverHolds.data) return
    const remote = serverHolds.data.filter((hold) => hold.status === 'Held').map((hold) => ({ ...hold.payload, id: `server-${hold.id}`, serverHoldId: hold.id, holdCode: hold.holdCode, savedAt: hold.createdAt, ownership: hold.ownership }))
    setHeldDrafts((previous) => {
      const local = previous.filter((item) => !item.serverHoldId)
      const next = [...remote, ...local].slice(0, 10)
      try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(local.slice(0, 10))) } catch { /* best effort */ }
      return next
    })
  }, [serverHolds.data])

  const catalogueQuery = useQuery({ queryKey: ['laundry-catalogue'], queryFn: () => apiGet<LaundryCatalogue>('/laundry/catalogue') })
  const customerQuery = useQuery({ queryKey: ['laundry-customers', customerSearch], queryFn: () => apiGet<Customer[]>(`/laundry/customers?search=${encodeURIComponent(customerSearch)}`), enabled: customerSearch.trim().length >= 2 })
  const items = useMemo(() => Object.values(cart), [cart])
  const quoteQuery = useQuery({
    queryKey: ['laundry-quote', JSON.stringify(items), customer?.id, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId],
    queryFn: () => apiPost<LaundryQuote>('/laundry/quote', { items, customerId: customer?.id, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId }),
    enabled: items.length > 0,
  })
  const booking = useMutation({
    mutationFn: () => apiPostOffline<BookingResult>('/laundry/orders', {
      customer: customer ? { id: customer.id, address: deliveryAddress || customer.address } : { name: newCustomerName, phone: newCustomerPhone, address: deliveryAddress },
      items, containerCount: containerCount === '' ? undefined : Number(containerCount), expectedDeliveryDate, fulfillmentMode: deliveryMode, serviceZone, cashRegister: paymentMode === 'Cash' ? cashRegister || undefined : undefined, paymentMode, paymentReference, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes, photoPaths: photoPath,
    }, 'laundry_order'),
    onSuccess: (result) => {
      setReceipt(result); setCart({}); setCustomer(null); setCustomerSearch(''); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setContainerCount(''); setPhotoPath(''); setPhotoError(''); setPaymentReference(''); setCashRegister(''); setPaymentMode('Pay Later'); setNotes(''); setChargeRuleIds([]); setDiscountRuleIds([]); setTaxRuleId('')
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['laundry-dashboard'] }); queryClient.invalidateQueries({ queryKey: ['laundry-orders'] }); queryClient.invalidateQueries({ queryKey: ['laundry-customers'] })
      const action = printSettings.data?.afterBooking || 'ask'
      if (action === 'open-print-centre' && result.order?.id) navigate(`/laundry/print-centre?order=${encodeURIComponent(result.order.id)}`)
      if (action === 'auto-print' && (result.tags?.length || result.containerTags?.length)) void printBookingDocuments(result, result.tags?.length ? 'tags' : 'bag-tags')
    },
  })

  const catalogue = catalogueQuery.data
  const garmentById = useMemo(() => new Map((catalogue?.garments || []).map((item) => [item.id, item])), [catalogue])
  const hasBulkItems = useMemo(() => items.some((item) => !['Piece', 'Pair'].includes(garmentById.get(item.garment)?.unit || 'Piece')), [items, garmentById])
  useEffect(() => { if (!hasBulkItems && containerCount !== '') setContainerCount('') }, [hasBulkItems, containerCount])
  const visiblePrices = useMemo(() => (catalogue?.prices || []).filter((price) => {
    const garment = garmentById.get(price.garment)
    return garment && (category === 'all' || garment.category === category) && (service === 'all' || price.service === service) && `${price.garmentName} ${price.serviceName}`.toLowerCase().includes(garmentSearch.trim().toLowerCase())
  }), [catalogue, garmentById, category, service, garmentSearch])

  function adjustLine(garment: string, serviceId: string, change: number) {
    const key = `${garment}:${serviceId}`
    setCart((previous) => {
      const next = { ...previous }; const line = next[key]
      const qty = (line?.qty || 0) + change
      if (qty <= 0) delete next[key]; else next[key] = { garment, service: serviceId, qty }
      return next
    })
  }

  function currentDraft(): BookingDraft {
    return { cart, customer, newCustomerName, newCustomerPhone, deliveryAddress, serviceZone, containerCount: containerCount === '' ? undefined : Number(containerCount), deliveryMode, expectedDeliveryDate, charges, discounts, taxRate, chargeRuleIds, discountRuleIds, taxRuleId, notes }
  }
  function clearCurrentDraft() {
    setCart({}); setCustomer(null); setCustomerSearch(''); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setContainerCount(''); setPhotoPath(''); setPhotoError(''); setPaymentReference(''); setPaymentMode('Pay Later'); setNotes(''); setChargeRuleIds([]); setDiscountRuleIds([]); setTaxRuleId('')
    try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* best effort */ }
  }
  async function holdCurrentDraft() {
    if (!items.length && !customer && !newCustomerName.trim()) return
    const held: HeldDraft = { ...currentDraft(), id: `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: new Date().toISOString(), paymentMode, paymentReference }
    try {
      await apiPost<ServerHold>('/laundry/order-holds', held)
      await queryClient.invalidateQueries({ queryKey: ['laundry-order-holds'] })
    } catch {
      setHeldDrafts((previous) => { const next = [held, ...previous.filter((item) => !item.serverHoldId)].slice(0, 10); try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(next)) } catch { /* best effort */ }; return next })
    }
    clearCurrentDraft()
  }
  async function resumeHeldDraft(held: HeldDraft) {
    let source = held
    if (held.serverHoldId) {
      try {
        if (held.ownership !== 'mine') await claimServerHold.mutateAsync(held.serverHoldId)
        const resumed = await resumeServerHold.mutateAsync(held.serverHoldId); source = { ...resumed.payload, ...held }
      } catch { return }
    }
    setCart(source.cart || {}); setCustomer(source.customer || null); setNewCustomerName(source.newCustomerName || ''); setNewCustomerPhone(source.newCustomerPhone || ''); setDeliveryAddress(source.deliveryAddress || ''); setServiceZone(source.serviceZone || ''); setContainerCount(source.containerCount === undefined ? '' : String(source.containerCount)); setDeliveryMode(source.deliveryMode || 'Home Delivery'); setExpectedDeliveryDate(source.expectedDeliveryDate || defaultDeliveryDate()); setCharges(source.charges || 0); setDiscounts(source.discounts || 0); setTaxRate(source.taxRate || 0); setChargeRuleIds(source.chargeRuleIds || []); setDiscountRuleIds(source.discountRuleIds || []); setTaxRuleId(source.taxRuleId || ''); setNotes(source.notes || ''); setPaymentMode(source.paymentMode || 'Pay Later'); setPaymentReference(source.paymentReference || '')
    setHeldDrafts((previous) => { const next = previous.filter((item) => item.id !== held.id); try { window.localStorage.setItem(HELD_DRAFTS_KEY, JSON.stringify(next.filter((item) => !item.serverHoldId))) } catch { /* best effort */ }; return next })
  }

  async function repeatLastOrder() {
    if (!customer) return
    setRepeatPending(true); setRepeatNotice('')
    try {
      const profile = await apiGet<{ orders: RepeatOrder[] }>(`/laundry/customers/${customer.id}`)
      const latest = profile.orders.find((order) => Array.isArray(order.items) && order.items.length > 0)
      if (!latest) { setRepeatNotice('No previous order is available for this customer.'); return }
      const available = new Set((catalogueQuery.data?.prices || []).map((price) => `${price.garment}:${price.service}`))
      const nextCart = Object.fromEntries(latest.items.filter((item) => available.has(`${item.garment}:${item.service}`) && Number(item.qty) > 0).map((item) => [`${item.garment}:${item.service}`, { garment: item.garment, service: item.service, qty: item.qty }]))
      if (!Object.keys(nextCart).length) { setRepeatNotice('The previous garments are no longer active in this branch catalogue.'); return }
      setCart(nextCart); if (latest.fulfillmentMode) setDeliveryMode(latest.fulfillmentMode); setServiceZone(latest.serviceZone || ''); setDeliveryAddress(latest.deliveryAddress || customer.address || ''); setNotes('')
      setRepeatNotice(`${Object.keys(nextCart).length} previous line${Object.keys(nextCart).length === 1 ? '' : 's'} restored. Review quantities and today’s delivery date before booking.`)
    } catch (error) { setRepeatNotice(error instanceof Error ? error.message : 'The previous order could not be loaded.') } finally { setRepeatPending(false) }
  }

  const canBook = items.length > 0 && expectedDeliveryDate && (customer || (newCustomerName.trim() && newCustomerPhone.trim())) && !booking.isPending
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        if (canBook) booking.mutate()
      } else if (event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        void holdCurrentDraft()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [canBook, booking, holdCurrentDraft])

  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Laundry POS</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Order & billing</h1><p className="mt-1 text-sm text-[#718087]">Build a clear garment record before it goes to the floor.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setCart({}); setCustomer(null); setNewCustomerName(''); setNewCustomerPhone(''); setDeliveryAddress(''); setServiceZone(''); setNotes(''); try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }} className="rounded-full border border-[#263f44]/15 bg-white px-3 py-1.5 text-xs font-semibold text-[#617178]">Clear draft</button><span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#3c796d]/20 bg-[#eaf3ef] px-3 py-1.5 text-xs font-semibold text-[#29635b]"><Check className="h-3.5 w-3.5" /> Server-calculated totals</span></div></div>

    <section className="mb-5 rounded-2xl border border-[#d7c38e]/50 bg-[#fff8e8] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Pause className="h-4 w-4 text-[#9b6d1d]" /><div><p className="text-sm font-bold text-[#704f19]">Counter hold queue</p><p className="text-xs text-[#8b7448]">Park an unfinished order for another customer without losing the work. Each server hold is owned by one counter until it is claimed.</p></div></div><button type="button" title="Shortcut: Ctrl/Cmd+Shift+H" disabled={!items.length && !customer && !newCustomerName.trim()} onClick={holdCurrentDraft} className="inline-flex items-center gap-1.5 rounded-lg bg-[#e6bc65] px-3 py-2 text-xs font-bold text-[#17363e] disabled:cursor-not-allowed disabled:opacity-45"><Pause className="h-3.5 w-3.5" />Hold current order</button></div>{holdPresence.data && <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-[#6d5a2d]"><span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.totalHeld} active hold{holdPresence.data.totalHeld === 1 ? '' : 's'}</span><span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.mineActive} on this counter</span>{holdPresence.data.otherActive > 0 && <span className="rounded-full bg-white/70 px-2.5 py-1">{holdPresence.data.otherActive} on another counter</span>}{holdPresence.data.expired > 0 && <span className="rounded-full bg-[#fce8d8] px-2.5 py-1 text-[#9a4f27]">{holdPresence.data.expired} lease{holdPresence.data.expired === 1 ? '' : 's'} expired · reclaim safely</span>}<span className="rounded-full bg-white/70 px-2.5 py-1">leases expire after {holdPresence.data.leaseMinutes} min</span></div>}{heldDrafts.length ? <div className="mt-3 flex flex-wrap gap-2">{heldDrafts.map((held) => <button type="button" key={held.id} onClick={() => resumeHeldDraft(held)} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-xs font-semibold text-[#315d57] ring-1 ring-inset ring-[#c69e4c]/30 hover:bg-[#fffdf5]"><PlayCircle className="h-4 w-4 text-[#39786f]" /><span>{held.customer?.name || held.newCustomerName || 'Walk-in draft'} · {Object.values(held.cart || {}).reduce((sum, line) => sum + line.qty, 0)} item(s)<small className="ml-1 block text-[10px] font-normal text-[#8b7448]">{held.ownership === 'other' || held.ownership === 'expired' ? `${held.ownership === 'expired' ? 'Lease expired · ' : ''}Claim & resume · ` : held.ownership === 'mine' ? 'Owned by this counter · ' : ''}{new Date(held.savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></span></button>)}</div> : <p className="mt-3 text-xs text-[#8b7448]">No held orders. Up to ten drafts are retained locally for this counter.</p>}</section>
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
      <section className="h-fit rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)] xl:sticky xl:top-24">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eaf3ef] text-[#39786f]"><UserPlus className="h-4 w-4" /></span><div><p className="font-semibold">Customer</p><p className="text-xs text-[#74848a]">Find or make one quickly</p></div></div>
        {customer ? <div className="mt-4 rounded-xl bg-[#edf5f1] p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-[#1d4e49]">{customer.name}</p><p className="mt-0.5 text-xs text-[#52716c]">{customer.phone}</p></div><button type="button" onClick={() => setCustomer(null)} className="rounded-lg p-1 text-[#52716c] hover:bg-white" aria-label="Clear customer"><X className="h-4 w-4" /></button></div><button type="button" disabled={repeatPending} onClick={() => void repeatLastOrder()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#39786f]/25 bg-white px-3 py-2 text-xs font-bold text-[#2d6b63] disabled:opacity-60"><RotateCcw className={`h-3.5 w-3.5 ${repeatPending ? 'animate-spin' : ''}`} />{repeatPending ? 'Loading previous order…' : 'Repeat last order'}</button>{repeatNotice ? <p role="status" className="mt-2 text-[11px] leading-4 text-[#52716c]">{repeatNotice}</p> : null}</div> : <>
          <div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search name or phone" className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none transition focus:border-[#438b82] focus:ring-2 focus:ring-[#b9ded6]" /></div>
          {customerQuery.data && <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[#263f44]/10 p-1">{customerQuery.data.map((result) => <button type="button" key={result.id} onClick={() => { setCustomer(result); setCustomerSearch('') }} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#edf5f1]"><span className="block text-sm font-medium">{result.name}</span><span className="text-xs text-[#718087]">{result.phone}</span></button>)}</div>}
          <div className="mt-5 border-t border-dashed border-[#263f44]/15 pt-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">New customer</p><input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Customer name" className="mb-2 h-10 w-full rounded-xl border border-[#263f44]/15 px-3 text-sm outline-none focus:border-[#438b82]" /><input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Phone number" inputMode="tel" className="h-10 w-full rounded-xl border border-[#263f44]/15 px-3 text-sm outline-none focus:border-[#438b82]" /></div>
        </>}
        <div className="mt-5 border-t border-dashed border-[#263f44]/15 pt-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">Fulfilment</p><div className="space-y-1.5">{(['Pickup Order', 'Home Delivery', 'Express Delivery'] as const).map((mode) => <button type="button" key={mode} onClick={() => setDeliveryMode(mode)} className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition', deliveryMode === mode ? 'bg-[#123039] text-white' : 'bg-[#f5f5f1] text-[#526368] hover:bg-[#eaeee8]')}><span>{mode}</span><span className={cn('h-2 w-2 rounded-full', deliveryMode === mode ? 'bg-[#e6bc65]' : 'bg-[#b1c1bc]')} /></button>)}</div>
          <label className="mt-4 block text-xs font-semibold text-[#617178]">Expected delivery<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-white px-2 text-sm outline-none focus:border-[#438b82]" /></label><label className="mt-3 block text-xs font-semibold text-[#617178]">Service zone<input value={serviceZone} onChange={(event) => setServiceZone(event.target.value.slice(0, 120))} placeholder="e.g. North • Downtown" className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm outline-none focus:border-[#438b82]" /><span className="mt-1 block text-[10px] font-normal text-[#81908f]">Used to group compatible rider routes.</span></label><label className="mt-3 block text-xs font-semibold text-[#617178]">Delivery address<textarea value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Address for pickup / delivery" className="mt-1.5 min-h-16 w-full rounded-xl border border-[#263f44]/15 bg-white p-2.5 text-sm font-normal outline-none focus:border-[#438b82]" /></label>
        </div>
      </section>

      <section className="min-w-0 rounded-[22px] border border-[#263f44]/10 bg-white p-4 shadow-[0_8px_28px_rgba(37,48,43,.04)] md:p-5">
        <div className="flex flex-col gap-3 border-b border-[#263f44]/10 pb-4"><div className="flex items-center justify-between"><div><p className="font-serif text-xl text-[#17353c]">Garment catalogue</p><p className="text-xs text-[#74848a]">Select the garment and service combination.</p></div><PackagePlus className="h-5 w-5 text-[#3a7d78]" /></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" /><input value={garmentSearch} onChange={(event) => setGarmentSearch(event.target.value)} placeholder="Search garments" className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#438b82]" /></div><Select value={category} onChange={setCategory} options={[{ id: 'all', name: 'All categories' }, ...(catalogue?.categories || [])]} /><Select value={service} onChange={setService} options={[{ id: 'all', name: 'All services' }, ...(catalogue?.services || [])]} /></div></div>
        {catalogueQuery.isLoading ? <div className="grid h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div> : catalogueQuery.isError ? <p className="p-8 text-center text-rose-700">The laundry catalogue could not be loaded.</p> : <div className="mt-4 grid max-h-[650px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 2xl:grid-cols-3">{visiblePrices.map((price) => { const garment = garmentById.get(price.garment)!; const line = cart[`${price.garment}:${price.service}`]; const visual = garment.photo || visualForGarment(garment.name); return <article key={price.id} className={cn('group rounded-2xl border p-3 transition', line ? 'border-[#57978d] bg-[#eef7f2]' : 'border-[#263f44]/10 bg-[#fcfcfa] hover:border-[#84b7af]')}><div className="flex items-start gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#e4ebe5]">{visual ? <img src={visual} alt={`${price.garmentName} Lndry visual`} loading="lazy" className="h-full w-full object-contain p-1" /> : <span className="font-serif text-base font-bold text-[#43736e]">{price.garmentName.slice(0, 1)}</span>}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#223b40]">{price.garmentName}</p><p className="mt-0.5 truncate text-xs text-[#718087]">{garment.categoryName} · {price.serviceName}</p><p className="mt-1 text-xs font-semibold text-[#4c756e]">{formatINR(price.rate)} / {garment.unit.toLowerCase()}</p></div></div><div className="mt-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#829092]">{garment.unit}</span>{line ? <div className="flex items-center gap-1 rounded-lg bg-white p-0.5 shadow-sm"><button onClick={() => adjustLine(price.garment, price.service, -1)} className="grid h-7 w-7 place-items-center rounded-md text-[#5d7274] hover:bg-[#edf4ef]" aria-label={`Decrease ${price.garmentName}`}><Minus className="h-3.5 w-3.5" /></button><span className="w-6 text-center text-sm font-bold tabular-nums">{line.qty}</span><button onClick={() => adjustLine(price.garment, price.service, 1)} className="grid h-7 w-7 place-items-center rounded-md bg-[#123039] text-white" aria-label={`Increase ${price.garmentName}`}><Plus className="h-3.5 w-3.5" /></button></div> : <button onClick={() => adjustLine(price.garment, price.service, 1)} className="rounded-lg bg-[#123039] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#1d4a53]">Add</button>}</div></article> })}{visiblePrices.length === 0 && <p className="col-span-full py-14 text-center text-sm text-[#718087]">No active price rules match these filters.</p>}</div>}
      </section>

      <section className="h-fit rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-4 shadow-[0_8px_28px_rgba(37,48,43,.05)] xl:sticky xl:top-24"><div className="flex items-center justify-between"><div><p className="font-serif text-xl text-[#17353c]">Selected</p><p className="text-xs text-[#74848a]">{items.length} garment line{items.length === 1 ? '' : 's'}</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e6bc65]/35 text-[#72511d]"><Tag className="h-4 w-4" /></span></div><div className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">{quoteQuery.data?.items.map((item) => <div key={`${item.garmentName}:${item.serviceName}`} className="rounded-xl bg-white p-3"><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.garmentName}</p><p className="text-xs text-[#718087]">{item.serviceName} · {item.qty} {item.unit.toLowerCase()}</p></div><p className="text-sm font-bold tabular-nums">{formatINR(item.amount)}</p></div></div>)}{items.length === 0 && <div className="rounded-2xl border border-dashed border-[#aabbb4] px-4 py-10 text-center text-sm text-[#718087]">Choose garments from the catalogue to start this order.</div>}</div>
        <div className="mt-4 rounded-xl border border-[#d7c38e]/60 bg-[#fff8e8] p-3"><label className="block text-xs font-bold text-[#704f19]">Bag / container count<input type="number" min="0" max="500" step="1" inputMode="numeric" value={containerCount} disabled={!hasBulkItems} onChange={(event) => setContainerCount(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder={hasBulkItems ? 'Optional — no bag tag until entered' : 'Available for weight or bulk lines'} className="mt-1.5 h-10 w-full rounded-lg border border-[#c69e4c]/35 bg-white px-3 text-sm font-semibold text-[#17353c] outline-none focus:border-[#9b6d1d] disabled:cursor-not-allowed disabled:bg-[#f2efe6]" /></label><p className="mt-1.5 text-[10px] leading-4 text-[#8b7448]">{hasBulkItems ? 'Creates explicit ELB container identities for the bulk quantity. Each bag can then be scanned and printed.' : 'Piece and pair orders create garment tags only; no container identity is fabricated.'}</p></div>
        <div className="mt-4 space-y-2 border-t border-[#263f44]/10 pt-4"><MoneyInput label="Additional charge" value={charges} onChange={setCharges} /><MoneyInput label="Discount" value={discounts} onChange={setDiscounts} /><MoneyInput label="Tax %" value={taxRate} onChange={setTaxRate} /></div>
        <ConfiguredRules catalogue={catalogue} chargeRuleIds={chargeRuleIds} discountRuleIds={discountRuleIds} taxRuleId={taxRuleId} onChargeChange={setChargeRuleIds} onDiscountChange={setDiscountRuleIds} onTaxChange={setTaxRuleId} />
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Order notes (optional)" className="mt-4 min-h-16 w-full rounded-xl border border-[#263f44]/15 bg-white p-3 text-sm outline-none focus:border-[#438b82]" /><label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#79a59b] bg-[#f5faf6] px-3 py-2.5 text-xs font-semibold text-[#39786f] hover:bg-[#edf6f0]"><ImagePlus className="h-4 w-4" />{photoPath ? 'Garment photo attached' : 'Attach garment photo (optional)'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setPhotoError('Choose an image under 1 MB.'); setPhotoPath(''); return } const reader = new FileReader(); reader.onload = () => { setPhotoPath(String(reader.result || '')); setPhotoError('') }; reader.readAsDataURL(file) }} /></label>{photoError && <p className="mt-1 text-xs text-rose-700">{photoError}</p>}
        <div className="mt-4 rounded-2xl bg-[#123039] p-4 text-[#edf3ec]"><div className="flex justify-between text-sm text-[#c4d7d0]"><span>Sub total</span><span>{formatINR(quoteQuery.data?.subtotal || 0)}</span></div><div className="mt-1.5 flex justify-between text-sm text-[#c4d7d0]"><span>Adjustments</span><span>{formatINR((quoteQuery.data?.charges || 0) - (quoteQuery.data?.discounts || 0) + (quoteQuery.data?.taxAmount || 0))}</span></div><div className="mt-3 flex items-end justify-between border-t border-white/15 pt-3"><span className="font-serif text-lg">Grand total</span><span className="font-serif text-2xl tabular-nums text-[#f1ca75]">{formatINR(quoteQuery.data?.grandTotal || 0)}</span></div></div>
        <div className="mt-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">Payment</p><div className="grid grid-cols-2 gap-1.5">{(['Pay Later', 'Cash', 'UPI', 'Card', 'Bank'] as const).map((mode) => <button key={mode} onClick={() => setPaymentMode(mode)} className={cn('rounded-xl px-2 py-2 text-xs font-bold transition', paymentMode === mode ? 'bg-[#e6bc65] text-[#17363e]' : 'bg-white text-[#617178] ring-1 ring-inset ring-[#263f44]/10 hover:bg-[#f2f4ee]')}>{mode}</button>)}</div>{paymentMode === 'Cash' && cashShifts.data?.filter((shift) => shift.status === 'Open').length ? <label className="mt-2 block text-xs font-semibold text-[#617178]">Cash register<select value={cashRegister} onChange={(event) => setCashRegister(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#263f44]/15 bg-white px-2.5 text-xs outline-none focus:border-[#438b82]"><option value="">{cashShifts.data.filter((shift) => shift.status === 'Open').length === 1 ? 'Main / only open register' : 'Choose an open register'}</option>{cashShifts.data.filter((shift) => shift.status === 'Open').map((shift) => <option key={shift.id} value={shift.register}>{shift.register}</option>)}</select></label> : null}{paymentMode !== 'Pay Later' && <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Payment reference / receipt no. (optional)" className="mt-2 h-9 w-full rounded-lg border border-[#263f44]/15 bg-white px-2.5 text-xs outline-none focus:border-[#438b82]" />}</div>
        {booking.isError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{booking.error instanceof Error ? booking.error.message : 'The order could not be booked.'}</p>}
        <button title="Shortcut: Ctrl/Cmd+Enter" disabled={!canBook} onClick={() => booking.mutate()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3a7d78] text-sm font-bold text-white shadow-[0_8px_16px_rgba(45,107,98,.2)] transition hover:bg-[#2d6863] disabled:cursor-not-allowed disabled:bg-[#a8b7b2]">{booking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}{booking.isPending ? 'Booking order…' : 'Book order'}</button>
      </section>
    </div>
    {receipt && <ReceiptDialog result={receipt} onClose={() => setReceipt(null)} />}
  </div>
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }> }) { return <label className="relative block"><select aria-label="Filter catalogue" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 pr-8 text-sm outline-none focus:border-[#438b82]"><>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</></select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-[#718087]" /></label> }
function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="flex items-center justify-between gap-3 text-sm"><span className="text-[#617178]">{label}</span><input aria-label={label} type="number" min="0" step="0.01" value={value || ''} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-8 w-24 rounded-lg border border-[#263f44]/15 bg-white px-2 text-right text-sm font-semibold outline-none focus:border-[#438b82]" /></label> }
function ConfiguredRules({ catalogue, chargeRuleIds, discountRuleIds, taxRuleId, onChargeChange, onDiscountChange, onTaxChange }: { catalogue?: LaundryCatalogue; chargeRuleIds: string[]; discountRuleIds: string[]; taxRuleId: string; onChargeChange: (value: string[]) => void; onDiscountChange: (value: string[]) => void; onTaxChange: (value: string) => void }) { if (!catalogue || (!catalogue.chargeRules.length && !catalogue.discountRules.length && !catalogue.taxRules.length)) return null; return <section className="mt-4 rounded-xl border border-[#4d8982]/15 bg-[#f4f8f5] p-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#527a71]">Configured rules</p><p className="mt-1 text-xs text-[#718087]">Selected rules are calculated on the local server and recorded with the quote.</p><RuleChoices label="Charges" rows={catalogue.chargeRules} selected={chargeRuleIds} onChange={onChargeChange} /><RuleChoices label="Discounts" rows={catalogue.discountRules} selected={discountRuleIds} onChange={onDiscountChange} /><label className="mt-3 block text-xs font-semibold text-[#526368]">Tax rule<select value={taxRuleId} onChange={(event) => onTaxChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[#263f44]/15 bg-white px-2 py-2 text-xs outline-none focus:border-[#438b82]"><option value="">Manual tax rate</option>{catalogue.taxRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.rate}%</option>)}</select></label></section> }
function RuleChoices({ label, rows, selected, onChange }: { label: string; rows: Array<{ id: string; name: string; type: 'Flat' | 'Percentage'; amount: number }>; selected: string[]; onChange: (value: string[]) => void }) { if (!rows.length) return null; return <fieldset className="mt-3"><legend className="text-xs font-semibold text-[#526368]">{label}</legend><div className="mt-1.5 space-y-1">{rows.map((rule) => <label key={rule.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs"><span className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(rule.id)} onChange={(event) => onChange(event.target.checked ? [...selected, rule.id] : selected.filter((id) => id !== rule.id))} className="accent-[#3a7d78]" />{rule.name}</span><span className="font-bold text-[#39786f]">{rule.type === 'Percentage' ? `${rule.amount}%` : formatINR(rule.amount)}</span></label>)}</div></fieldset> }
function ReceiptDialog({ result, onClose }: { result: BookingResult; onClose: () => void }) { const receipt = result.receipt; const tags = result.tags || []; const containerTags = result.containerTags || []; const [printNotice, setPrintNotice] = useState(''); async function handlePrint(kind: 'tags' | 'bag-tags' | 'receipt', pdf = false) { setPrintNotice(''); try { const outcome = await printBookingDocuments(result, kind, pdf); setPrintNotice(!outcome.ok ? 'Printing was cancelled or could not be started. No output was recorded as printed.' : !outcome.auditRecorded ? 'The document action completed, but print history could not be saved. Retry from Print Centre if needed.' : pdf ? 'PDF export completed and was recorded in print history.' : 'Print command accepted and recorded in print history. Confirm the physical output at the station.') } catch (error) { setPrintNotice(error instanceof Error ? error.message : 'The document could not be prepared. The order remains saved.') } } return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102b33]/55 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] bg-[#fffdf8] p-5 shadow-2xl"><div className="flex justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Order booked</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{receipt.orderNumber}</h2></div><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#f0eee9]" aria-label="Close receipt"><X className="h-4 w-4" /></button></div><div className="mt-5 rounded-2xl border border-dashed border-[#8daaa0] bg-white p-4"><div className="flex justify-between text-sm"><span>{receipt.customer.name}</span><span>{receipt.customer.phone}</span></div><p className="mt-1 text-xs text-[#718087]">Invoice {receipt.invoiceNumber} · Delivery {receipt.expectedDeliveryDate}</p><div className="mt-4 space-y-2 border-y border-[#263f44]/10 py-3">{receipt.items.map((item) => <div key={`${item.garmentName}:${item.serviceName}`} className="flex justify-between text-sm"><span>{item.garmentName} × {item.qty}</span><span>{formatINR(item.amount)}</span></div>)}</div><div className="mt-3 flex justify-between font-serif text-xl"><span>Total</span><span>{formatINR(receipt.grandTotal)}</span></div><p className="mt-2 text-xs text-[#718087]">{receipt.paymentStatus} · {receipt.paymentMode}</p></div><div className="mt-5"><p className="text-xs font-bold uppercase tracking-[.15em] text-[#648077]">Garment tags ({tags.length})</p><div className="mt-2 grid grid-cols-2 gap-2">{tags.map((tag) => <div key={tag.tagNumber} className="rounded-xl border border-[#263f44]/10 bg-white p-2.5 text-xs"><p className="font-bold text-[#225861]">{tag.tagNumber} <span className="font-normal text-[#718087]">({tag.sequence} / {tag.total})</span></p><p className="mt-1 font-medium">{tag.garment}</p><p className="text-[#718087]">{tag.service} · Due {tag.expectedDeliveryDate}</p><p className="text-[10px] text-[#91a09f]">Order date {tag.orderDate}</p></div>)}</div>{containerTags.length ? <><p className="mt-5 text-xs font-bold uppercase tracking-[.15em] text-[#648077]">Bag / container tags ({containerTags.length})</p><div className="mt-2 grid grid-cols-2 gap-2">{containerTags.map((tag) => <div key={tag.tagNumber} className="rounded-xl border border-[#d7c38e]/60 bg-[#fff8e8] p-2.5 text-xs"><p className="font-bold text-[#704f19]">{tag.tagNumber} <span className="font-normal text-[#8b7448]">({tag.sequence} / {tag.total})</span></p><p className="mt-1 font-medium">{tag.garment}</p><p className="text-[#8b7448]">{tag.service}</p></div>)}</div></> : null}</div>{printNotice ? <p role="status" className="mt-4 rounded-xl bg-[#eaf3ef] p-3 text-xs font-semibold text-[#2e6a60]">{printNotice}</p> : null}<div className="mt-5 grid gap-2 sm:grid-cols-2"><button disabled={!tags.length} onClick={() => void handlePrint('tags')} className="flex items-center justify-center gap-2 rounded-xl bg-[#123039] py-3 text-xs font-bold text-white disabled:opacity-40"><Printer className="h-4 w-4" />{tags.length ? `Print ${tags.length} garment tags` : 'No garment tags'}</button><button onClick={() => void handlePrint('receipt')} className="flex items-center justify-center gap-2 rounded-xl border border-[#123039]/15 bg-white py-3 text-xs font-bold text-[#17353c]"><Printer className="h-4 w-4" />Print invoice</button><button disabled={!containerTags.length} onClick={() => void handlePrint('bag-tags')} className="flex items-center justify-center gap-2 rounded-xl border border-[#d7c38e] bg-[#fff8e8] py-3 text-xs font-bold text-[#704f19] disabled:opacity-40"><Tag className="h-4 w-4" />{containerTags.length ? `Print ${containerTags.length} bag tags` : 'No bag tags'}</button><button disabled={!tags.length} onClick={() => void handlePrint('tags', true)} className="flex items-center justify-center gap-2 rounded-xl border border-[#123039]/15 bg-white py-3 text-xs font-bold text-[#17353c] disabled:opacity-40"><Download className="h-4 w-4" />Tags PDF</button></div></div></div> }

type PrintActionResult = { ok: boolean; auditRecorded: boolean }

async function printBookingDocuments(result: BookingResult, kind: 'tags' | 'bag-tags' | 'receipt' = 'tags', pdf = false): Promise<PrintActionResult> {
  const settings = await apiGet<PrintSettings>('/laundry/print-settings').catch(() => ({} as PrintSettings))
  const order: PrintOrder = { id: result.order?.id || result.receipt.orderNumber, orderNumber: result.receipt.orderNumber, invoiceNumber: result.receipt.invoiceNumber, customer: result.receipt.customer, expectedDeliveryDate: result.receipt.expectedDeliveryDate, fulfillmentMode: result.receipt.fulfillmentMode, receipt: result.receipt }
  const physicalTags = kind === 'bag-tags' ? result.containerTags || [] : result.tags
  const html = await buildLaundryPrintHtml(kind === 'receipt' ? 'receipt' : 'tags', order, settings, physicalTags)
  let ok = false
  if (pdf && window.epic?.exportHtmlPdf) ok = Boolean((await window.epic.exportHtmlPdf(html, `${result.receipt.orderNumber}-${kind}`)).ok)
  else if (!pdf && window.epic?.printHtml) ok = Boolean((await window.epic.printHtml(html)).ok)
  else { const popup = window.open('', '_blank', 'width=900,height=1100'); if (popup) { popup.document.write(html + '<script>window.onload=()=>window.print()<\/script>'); popup.document.close(); ok = true } }
  let auditRecorded = false
  try { await apiPost('/laundry/print-jobs', { orderId: result.order?.id || result.receipt.orderNumber, templateId: 'recommended-a4-6', templateVersion: '1', ...(kind === 'bag-tags' ? { containerIds: physicalTags.map((tag) => tag.containerId || tag.tagNumber) } : kind === 'tags' ? { tagIds: physicalTags.map((tag) => tag.tagNumber) } : {}), documentType: kind, requestedCopies: 1, status: ok ? (pdf ? 'Downloaded' : 'Printed') : 'Cancelled', evidence: ok ? (pdf ? 'Electron printToPDF completed' : 'Native print command accepted; physical output not independently verified') : 'Operator cancelled or print command failed' }); auditRecorded = true } catch { /* the booking itself is already committed; the caller reports the missing audit record */ }
  return { ok, auditRecorded }
}
function defaultDeliveryDate() { const date = new Date(); date.setDate(date.getDate() + 2); return localDateKey(date) }
function visualForGarment(name: string) { const lower = name.toLowerCase(); if (lower.includes('blazer') || lower.includes('jacket') || lower.includes('coat') || lower.includes('suit')) return garmentVisuals.foldedBlazer; if (lower.includes('dress') || lower.includes('gown')) return garmentVisuals.foldedDress; if (lower.includes('jean') || lower.includes('denim')) return garmentVisuals.foldedJeans; if (lower.includes('hoodie') || lower.includes('sweatshirt')) return garmentVisuals.foldedHoodie; if (lower.includes('kurta')) return garmentVisuals.foldedKurta; if (lower.includes('trouser') || lower.includes('pant')) return garmentVisuals.foldedTrouser; if (lower.includes('saree')) return garmentVisuals.foldedSaree; if (lower.includes('kurti')) return garmentVisuals.foldedKurti; if (lower.includes('blanket')) return garmentVisuals.foldedBlanket; if (lower.includes('sheet')) return garmentVisuals.foldedBedsheet; if (lower.includes('shoe')) return garmentVisuals.shoePair; if (lower.includes('mixed') || lower.includes('clothes')) return garmentVisuals.mixedClothes; if (lower.includes('shirt')) return garmentVisuals.foldedShirt; return garmentVisuals.foldedShirt }
