import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChevronRight,
  CircleDollarSign,
  Download,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost, operatorErrorMessage } from "@/lib/api";
import {
  nextLaundryState,
  stateTone,
  type LaundryCatalogue,
  type LaundryFulfillmentEvent,
  type LaundryOrder,
  type LaundryPaymentSummary,
  type LaundryState,
} from "@/lib/laundry";
import { cn, formatINR } from "@/lib/utils";
import OrderItemEditor from "@/components/laundry/OrderItemEditor";

const states: Array<LaundryState | "all"> = [
  "all",
  "Booked",
  "Picked Up",
  "In Process",
  "Ready",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
];

export default function LaundryOrders() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<LaundryState | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const order = searchParams.get("order");
    if (order) setSelected(order);
  }, [searchParams]);
  const filters = new URLSearchParams({
    search,
    ...(state === "all" ? {} : { state }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const orders = useQuery({
    queryKey: ["laundry-orders", search, state, from, to],
    queryFn: () =>
      apiGet<LaundryOrder[]>(`/laundry/orders?${filters.toString()}`),
  });
  const detail = useQuery({
    queryKey: ["laundry-order", selected],
    queryFn: () =>
      apiGet<
        LaundryOrder & {
          timeline: Array<{ id: string; ts: string; action: string }>;
          tags?: Array<OrderTag>;
        }
      >(`/laundry/orders/${selected}`),
    enabled: Boolean(selected),
  });
  const transition = useMutation({
    mutationFn: ({
      id,
      next,
      expectedVersion,
    }: {
      id: string;
      next: LaundryState;
      expectedVersion?: number;
    }) =>
      apiPost<LaundryOrder>(`/laundry/orders/${id}/transition`, {
        state: next,
        expectedVersion,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order"] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-dispatch"] });
    },
  });
  const rows = orders.data || [];
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
            Operations
          </p>
          <h1 className="mt-1 font-serif text-3xl text-[#17353c]">
            Store orders
          </h1>
          <p className="mt-1 text-sm text-[#718087]">
            Search, inspect, export, and deliberately move orders through the
            laundry floor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => orders.refetch()}
            className="inline-flex items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-sm font-semibold text-[#315d57]"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-[#263f44]/15 bg-white px-3 py-2 text-sm font-semibold text-[#315d57]"
          >
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => void exportOrders(rows)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3 py-2 text-sm font-bold text-white disabled:bg-[#a8b7b2]"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
        <section className="overflow-hidden rounded-[22px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
          <div className="grid gap-3 border-b border-[#263f44]/10 p-4 lg:grid-cols-[minmax(0,1fr)_180px_135px_135px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e8d90]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order no, invoice, customer or phone"
                className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] pl-9 pr-3 text-sm outline-none focus:border-[#438b82]"
              />
            </div>
            <select
              aria-label="Filter status"
              value={state}
              onChange={(event) =>
                setState(event.target.value as LaundryState | "all")
              }
              className="h-10 rounded-xl border border-[#263f44]/15 bg-[#fbfbf9] px-3 text-sm outline-none focus:border-[#438b82]"
            >
              {states.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All statuses" : option}
                </option>
              ))}
            </select>
            <DateFilter label="From" value={from} onChange={setFrom} />
            <DateFilter label="To" value={to} onChange={setTo} />
          </div>
          <div className="flex items-center justify-between border-b border-[#263f44]/8 px-5 py-2.5 text-xs text-[#617178]">
            <span>
              <strong className="text-[#315d57]">{rows.length}</strong> matching
              order{rows.length === 1 ? "" : "s"}
            </span>
            <span>
              Print opens the system dialog; choose “Save as PDF” when needed.
            </span>
          </div>
          <OrderTable
            rows={rows}
            loading={orders.isLoading}
            selected={selected}
            pending={transition.isPending}
            onSelect={setSelected}
            onTransition={(id, next, expectedVersion) =>
              transition.mutate({ id, next, expectedVersion })
            }
          />
        </section>
        <OrderDetail
          order={detail.data}
          loading={detail.isLoading}
          onClose={() => setSelected(null)}
        />
      </div>
      {transition.isError ? (
        <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {transition.error instanceof Error
            ? operatorErrorMessage(transition.error, "The order status could not be updated.")
            : "The order status could not be updated."}
        </p>
      ) : null}
    </div>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#718087]">
      {label}
      <input
        aria-label={`${label} date`}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-8 w-full rounded-lg border border-[#263f44]/15 bg-[#fbfbf9] px-2 text-sm font-normal normal-case tracking-normal text-[#40565a]"
      />
    </label>
  );
}
function OrderTable({
  rows,
  loading,
  selected,
  pending,
  onSelect,
  onTransition,
}: {
  rows: LaundryOrder[];
  loading: boolean;
  selected: string | null;
  pending: boolean;
  onSelect: (id: string) => void;
  onTransition: (
    id: string,
    next: LaundryState,
    expectedVersion?: number,
  ) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[870px] text-left text-sm">
        <thead className="bg-[#fafaf7] text-[10px] font-bold uppercase tracking-[.14em] text-[#718087]">
          <tr>
            <th className="px-5 py-3">Invoice / order</th>
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Dates</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="py-16 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#3a7d78]" />
              </td>
            </tr>
          ) : rows.length ? (
            rows.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                active={selected === order.id}
                pending={pending}
                onSelect={onSelect}
                onTransition={onTransition}
              />
            ))
          ) : (
            <tr>
              <td colSpan={6} className="py-16 text-center text-[#718087]">
                No orders match this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function OrderRow({
  order,
  active,
  pending,
  onSelect,
  onTransition,
}: {
  order: LaundryOrder;
  active: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onTransition: (
    id: string,
    next: LaundryState,
    expectedVersion?: number,
  ) => void;
}) {
  const next = nextLaundryState[order.state];
  const needsRider = next === "Out for Delivery" && !order.deliveryRider;
  return (
    <tr
      className={cn(
        "border-t border-[#263f44]/8 transition hover:bg-[#f7f8f4]",
        active ? "bg-[#eff7f3]" : "",
      )}
    >
      <td
        className="cursor-pointer px-5 py-4"
        onClick={() => onSelect(order.id)}
      >
        <span className="block font-bold text-[#205660]">
          {order.invoiceNumber || "—"}
        </span>
        <span className="text-xs text-[#718087]">
          {order.orderNumber} · {order.itemCount} items
        </span>
      </td>
      <td
        className="cursor-pointer px-3 py-4"
        onClick={() => onSelect(order.id)}
      >
        <span className="block font-medium">{order.customer.name}</span>
        <span className="text-xs text-[#718087]">{order.customer.phone}</span>
      </td>
      <td
        className="cursor-pointer px-3 py-4 text-xs text-[#617178]"
        onClick={() => onSelect(order.id)}
      >
        <span className="block">Booked {date(order.orderDate)}</span>
        <span className="mt-1 block">
          Due {date(order.expectedDeliveryDate)}
        </span>
      </td>
      <td className="px-3 py-4 font-bold tabular-nums">
        {formatINR(order.grandTotal)}
      </td>
      <td className="px-3 py-4">
        <StatePill state={order.state} />
      </td>
      <td className="px-5 py-4 text-right">
        {next ? (
          needsRider ? (
            <Link
              to="/laundry/dispatch"
              className="inline-flex items-center gap-1 rounded-lg bg-[#e7f3ed] px-2.5 py-1.5 text-xs font-bold text-[#2b6c62]"
            >
              Assign rider
              <Truck className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              disabled={pending}
              onClick={() => onTransition(order.id, next, order.version)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#123039] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#1d4a53]"
            >
              {next}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )
        ) : (
          <button
            onClick={() => onSelect(order.id)}
            className="text-xs font-bold text-[#39786f]"
          >
            View
          </button>
        )}
      </td>
    </tr>
  );
}
type OrderTag = {
  tagNumber: string;
  garment: string;
  service: string;
  sequence: number;
  total: number;
  orderDate: string;
  expectedDeliveryDate: string;
};
function TraceabilitySummary({ order }: { order: LaundryOrder & { tags?: Array<OrderTag> } }) {
  const expectedPieces = order.items.reduce((sum, item) => /^(piece|pair)$/i.test(item.unit) ? sum + item.qty : sum, 0);
  const units = order.physicalUnits || [];
  const containers = order.containers || [];
  const accounted = expectedPieces === units.length;
  return <section className="mt-4 rounded-xl border border-[#39786f]/20 bg-[#f3faf6] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#39786f]">Assembly safety · garment traceability</p><p className="mt-1 text-xs text-[#52676b]">{expectedPieces ? `${units.length} of ${expectedPieces} expected piece tags accounted for.` : containers.length ? `${containers.length} explicit container tag${containers.length === 1 ? '' : 's'} accounted for; no piece tags fabricated for bulk lines.` : 'No physical identity has been recorded yet.'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${accounted ? 'bg-[#dcefe5] text-[#2e6a60]' : 'bg-amber-100 text-amber-800'}`}>{expectedPieces ? accounted ? 'Ready to assemble' : 'Hold · investigate mismatch' : containers.length ? 'Container-controlled' : 'Identity pending'}</span></div>
    {units.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{units.map((unit) => <div key={unit.id} className="rounded-lg border border-[#39786f]/10 bg-white px-2.5 py-2 text-[10px]"><div className="flex items-center justify-between gap-2"><span className="font-mono font-bold text-[#315d57]">{unit.tagCode}</span><span className="rounded-full bg-[#eaf3ef] px-1.5 py-0.5 font-bold text-[#2e6a60]">{unit.state}</span></div><p className="mt-1 truncate text-[#617178]">{unit.garment.name} · {unit.service.name} · {unit.location || 'No location'} · {unit.condition}</p><Link to={`/laundry/garment-tracking?tag=${encodeURIComponent(unit.tagCode)}`} className="mt-1 inline-block font-bold text-[#39786f]">Scan · history · reprint · replace</Link></div>)}</div> : null}
    <div className="mt-3 flex flex-wrap gap-2"><Link to={`/laundry/garment-tracking?tag=${encodeURIComponent(units[0]?.tagCode || containers[0]?.tagCode || '')}`} className="rounded-lg border border-[#39786f]/20 bg-white px-3 py-1.5 text-[10px] font-bold text-[#39786f]">Open tracking</Link><Link to={`/laundry/print-centre?order=${encodeURIComponent(order.id)}`} className="rounded-lg border border-[#39786f]/20 bg-white px-3 py-1.5 text-[10px] font-bold text-[#39786f]">Open Print Centre</Link></div>
  </section>;
}
function OrderDetail({
  order,
  loading,
  onClose,
}: {
  order?: LaundryOrder & {
    timeline: Array<{ id: string; ts: string; action: string }>;
    tags?: Array<OrderTag>;
  };
  loading: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"Cash" | "UPI" | "Card" | "Bank">("Cash");
  const [cashRegister, setCashRegister] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [fulfilmentItem, setFulfilmentItem] = useState("0");
  const [fulfilmentStage, setFulfilmentStage] =
    useState<LaundryFulfillmentEvent["stage"]>("Picked Up");
  const [fulfilmentQty, setFulfilmentQty] = useState("");
  const [fulfilmentNote, setFulfilmentNote] = useState("");
  const [editingOrder, setEditingOrder] = useState(false);
  const [editLines, setEditLines] = useState<
    Array<{ garment: string; service: string; qty: string }>
  >([]);
  const [error, setError] = useState("");
  const paymentQuery = useQuery({
    queryKey: ["laundry-order-payments", order?.id],
    queryFn: () =>
      apiGet<LaundryPaymentSummary>(`/laundry/orders/${order!.id}/payments`),
    enabled: Boolean(order?.id),
  });
  const cashShifts = useQuery({
    queryKey: ["laundry-order-cash-shifts"],
    queryFn: () =>
      apiGet<Array<{ id: string; status: string; register: string }>>(
        "/laundry/cash-shifts",
      ),
    enabled: mode === "Cash" && Boolean(order?.id),
    retry: false,
  });
  const fulfilmentQuery = useQuery({
    queryKey: ["laundry-order-fulfilment", order?.id],
    queryFn: () =>
      apiGet<LaundryFulfillmentEvent[]>(
        `/laundry/orders/${order!.id}/fulfillment`,
      ),
    enabled: Boolean(order?.id),
  });
  const catalogueQuery = useQuery({
    queryKey: ["laundry-order-edit-catalogue"],
    queryFn: () => apiGet<LaundryCatalogue>("/laundry/catalogue"),
    enabled: editingOrder,
  });
  const collect = useMutation({
    mutationFn: () =>
      apiPost<{ summary: LaundryPaymentSummary }>(
        `/laundry/orders/${order!.id}/payments`,
        {
          amount: Number(amount),
          mode,
          reference,
          note,
          cashRegister: mode === "Cash" ? cashRegister || undefined : undefined,
        },
      ),
    onSuccess: () => {
      setAmount("");
      setReference("");
      setNote("");
      setCashRegister("");
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be recorded.",
      ),
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<LaundryPaymentSummary>(`/laundry/payments/${id}/reverse`, {
        reason,
      }),
    onSuccess: () => {
      setReverseTarget(null);
      setReverseReason("");
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be reversed.",
      ),
  });
  const fulfilment = useMutation({
    mutationFn: () =>
      apiPost<LaundryFulfillmentEvent>(
        `/laundry/orders/${order!.id}/fulfillment`,
        {
          itemIndex: Number(fulfilmentItem),
          stage: fulfilmentStage,
          quantity: Number(fulfilmentQty),
          note: fulfilmentNote,
        },
      ),
    onSuccess: () => {
      setFulfilmentQty("");
      setFulfilmentNote("");
      setError("");
      void fulfilmentQuery.refetch();
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Fulfilment event could not be recorded.",
      ),
  });
  const cancelOrder = useMutation({
    mutationFn: (reason: string) =>
      apiPost<LaundryOrder>(`/laundry/orders/${order!.id}/cancel`, {
        reason,
        expectedVersion: order!.version,
      }),
    onSuccess: () => {
      setCancelReason("");
      setShowCancel(false);
      setError("");
      void paymentQuery.refetch();
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-reports"] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Order could not be cancelled.",
      ),
  });
  const editOrder = useMutation({
    mutationFn: () =>
      apiPatch<LaundryOrder>(`/laundry/orders/${order!.id}`, {
        items: editLines.map((line) => ({
          garment: line.garment,
          service: line.service,
          qty: Number(line.qty),
        })),
        expectedDeliveryDate: order!.expectedDeliveryDate,
        fulfillmentMode: order!.fulfillmentMode,
        charges: order!.charges,
        discounts: order!.discounts,
        taxRate: order!.taxRate,
        notes: order!.notes,
        deliveryAddress: order!.deliveryAddress,
        serviceZone: order!.serviceZone,
        expectedVersion: order!.version,
      }),
    onSuccess: () => {
      setEditingOrder(false);
      setEditLines([]);
      setError("");
      client.invalidateQueries({ queryKey: ["laundry-orders"] });
      client.invalidateQueries({ queryKey: ["laundry-order", order?.id] });
      client.invalidateQueries({ queryKey: ["laundry-dashboard"] });
      client.invalidateQueries({ queryKey: ["laundry-reports"] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "Order could not be edited.",
      ),
  });
  if (!order && !loading)
    return (
      <aside className="rounded-[22px] border border-dashed border-[#99afa8] bg-[#fbfcf8] p-6 text-center text-sm text-[#718087]">
        <Tag className="mx-auto mb-3 h-5 w-5 text-[#55938a]" />
        Select an order to review its garments, payment, rider, and audit trail.
      </aside>
    );
  if (loading || !order)
    return (
      <aside className="grid h-80 place-items-center rounded-[22px] border border-[#263f44]/10 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-[#3a7d78]" />
      </aside>
    );
  const rider = order.deliveryRider || order.pickupRider;
  const summary = paymentQuery.data;
  return (
    <aside className="h-fit rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.05)] xl:sticky xl:top-24">
      <div className="flex justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Order work card
          </p>
          <h2 className="mt-1 font-serif text-xl text-[#17353c]">
            {order.orderNumber}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#f0eee9]"
            aria-label="Close order details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-white p-3">
        <div>
          <p className="font-semibold">{order.customer.name}</p>
          <p className="text-xs text-[#718087]">{order.customer.phone}</p>
        </div>
        <StatePill state={order.state} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!["Delivered", "Cancelled"].includes(order.state) ? (
          <button
            type="button"
            onClick={() => {
              setEditingOrder(true);
              setEditLines(
                order.items.map((item) => ({
                  garment: item.garment || "",
                  service: item.service || "",
                  qty: String(item.qty),
                })),
              );
              setError("");
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#39786f]/25 bg-[#eaf3ef] px-3 py-2 text-xs font-bold text-[#39786f]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit items
          </button>
        ) : (
          <span />
        )}
        {!["Delivered", "Cancelled"].includes(order.state) ? (
          <button
            type="button"
            disabled={cancelOrder.isPending}
            onClick={() => {
              setShowCancel((visible) => !visible);
              setError("");
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-60"
          >
            <Ban className="h-3.5 w-3.5" />
            {showCancel ? "Close cancellation" : cancelOrder.isPending ? "Cancelling…" : "Cancel order"}
          </button>
        ) : null}
      </div>
      {showCancel ? (
        <section className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-bold text-rose-800">Cancellation reason required</p>
          <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Explain why this order is being cancelled" className="mt-2 min-h-16 w-full rounded-lg border border-rose-200 bg-white p-2 text-xs outline-none focus:border-rose-400" />
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => setShowCancel(false)} className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">Keep order</button><button type="button" disabled={cancelOrder.isPending || !cancelReason.trim()} onClick={() => cancelOrder.mutate(cancelReason.trim())} className="flex-1 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{cancelOrder.isPending ? "Cancelling…" : "Confirm cancellation"}</button></div>
        </section>
      ) : null}
      <div className="mt-4 space-y-2">
        {order.items.map((item, index) => (
          <div
            key={`${item.garmentName}:${index}`}
            className="rounded-xl border border-[#263f44]/8 bg-white p-3 text-sm"
          >
            <div className="flex justify-between">
              <span>
                <span className="block font-medium">{item.garmentName}</span>
                <span className="text-xs text-[#718087]">
                  {item.serviceName} · {item.qty} {item.unit.toLowerCase()}
                </span>
              </span>
              <span className="font-bold tabular-nums">
                {formatINR(item.amount)}
              </span>
            </div>
            {item.fulfilment ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#718087]">
                <span>
                  Received {item.fulfilment.received}/{item.fulfilment.ordered}
                </span>
                <span className="font-semibold text-[#39786f]">
                  Delivered {item.fulfilment.delivered}
                </span>
                <span
                  className={
                    item.fulfilment.pending
                      ? "font-semibold text-[#a97420]"
                      : ""
                  }
                >
                  Pending {item.fulfilment.pending}
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <TraceabilitySummary order={order} />
      {editingOrder ? (
        <section className="mt-3 rounded-xl border border-[#39786f]/20 bg-[#f3faf6] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#39786f]">
            Controlled edit
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[#617178]">
            Only unpaid orders can be amended. A replacement invoice and
            explicit ledger adjustment preserve the original history.
          </p>
          <OrderItemEditor
            order={order}
            lines={editLines}
            setLines={setEditLines}
            catalogue={catalogueQuery.data}
            loading={catalogueQuery.isLoading}
            failed={catalogueQuery.isError}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={editOrder.isPending}
              onClick={() => editOrder.mutate()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#39786f] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {editOrder.isPending ? "Saving…" : "Save replacement"}
            </button>
            <button
              type="button"
              onClick={() => setEditingOrder(false)}
              className="rounded-lg border border-[#39786f]/20 px-3 py-2 text-xs font-bold text-[#39786f]"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <div className="mt-4 flex justify-between border-t border-[#263f44]/10 pt-4">
        <span className="text-sm text-[#617178]">
          {summary?.status || order.paymentStatus} · {order.paymentMode}
        </span>
        <span className="font-serif text-xl">
          {formatINR(summary?.total ?? order.grandTotal)}
        </span>
      </div>
      <div className="mt-4 rounded-xl bg-[#eaf3ef] p-3 text-xs text-[#32695f]">
        <Truck className="mr-1.5 inline h-4 w-4" />
        {rider
          ? `${rider.name}${rider.phone ? ` · ${rider.phone}` : ""}`
          : "No rider assigned"}{" "}
        · {order.fulfillmentMode}
      </div>
      <section className="mt-4 rounded-xl border border-[#263f44]/10 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">
          Fulfilment details
        </p>
        <p className="mt-1 text-xs leading-5 text-[#617178]">
          {order.deliveryAddress || "No delivery address recorded."}
        </p>
        {order.photoPaths && (
          <img
            src={order.photoPaths}
            alt="Attached garment"
            className="mt-2 h-20 w-20 rounded-lg object-cover ring-1 ring-[#263f44]/10"
          />
        )}
        <div className="mt-3 border-t border-dashed border-[#263f44]/10 pt-3">
          <p className="text-xs font-semibold text-[#40565a]">
            Record item progress
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              aria-label="Fulfilment item"
              value={fulfilmentItem}
              onChange={(event) => setFulfilmentItem(event.target.value)}
              className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
            >
              {order.items.map((item, index) => (
                <option key={index} value={index}>
                  {index + 1}. {item.garmentName}
                </option>
              ))}
            </select>
            <select
              aria-label="Fulfilment stage"
              value={fulfilmentStage}
              onChange={(event) =>
                setFulfilmentStage(
                  event.target.value as LaundryFulfillmentEvent["stage"],
                )
              }
              className="h-8 rounded-lg border border-[#263f44]/15 bg-white px-2 text-xs"
            >
              <option>Picked Up</option>
              <option>In Process</option>
              <option>Ready</option>
              <option>Delivered</option>
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={fulfilmentQty}
              onChange={(event) => setFulfilmentQty(event.target.value)}
              type="number"
              min="0.01"
              step="0.01"
              placeholder={`Qty (${order.items[Number(fulfilmentItem)]?.unit || "Piece"})`}
              className="h-8 w-24 rounded-lg border border-[#263f44]/15 px-2 text-xs"
            />
            <input
              value={fulfilmentNote}
              onChange={(event) => setFulfilmentNote(event.target.value)}
              placeholder="Progress note (optional)"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[#263f44]/15 px-2 text-xs"
            />
          </div>
          <button
            type="button"
            disabled={fulfilment.isPending || !Number(fulfilmentQty)}
            onClick={() => fulfilment.mutate()}
            className="mt-2 h-8 w-full rounded-lg bg-[#3a7d78] text-xs font-bold text-white disabled:bg-[#a8b7b2]"
          >
            {fulfilment.isPending ? "Saving…" : "Save progress event"}
          </button>
          {fulfilmentQuery.data?.length ? (
            <div className="mt-2 space-y-1">
              {fulfilmentQuery.data
                .slice()
                .reverse()
                .map((event) => (
                  <div
                    key={event.id}
                    className="flex justify-between rounded-lg bg-[#f7faf7] px-2 py-1.5 text-[10px] text-[#617178]"
                  >
                    <span>
                      <strong>{event.stage}</strong> · item{" "}
                      {event.itemIndex + 1}
                    </span>
                    <span>
                      {event.quantity} {event.unit}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-[#819094]">
              No item-level events recorded yet.
            </p>
          )}
        </div>
      </section>
      {order.tags?.length ? (
        <section className="mt-4 rounded-xl border border-[#664cf0]/15 bg-[#f7f5ff] p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#5b45c8]">
              <Tag className="h-3.5 w-3.5" />
              Garment tags
            </p>
            <span className="text-[10px] font-semibold text-[#756e9a]">
              {order.tags.length} physical unit
              {order.tags.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {order.tags.map((tag) => (
              <div
                key={tag.tagNumber}
                className="rounded-lg border border-[#664cf0]/10 bg-white p-2.5"
              >
                <p className="text-xs font-bold text-[#4b3bb0]">
                  {tag.tagNumber}{" "}
                  <span className="font-normal text-[#8178a8]">
                    · {tag.sequence}/{tag.total}
                  </span>
                </p>
                <p className="mt-1 text-xs font-semibold text-[#443b58]">
                  {tag.garment}
                </p>
                <p className="text-[10px] text-[#8178a8]">
                  {tag.service} · Due {tag.expectedDeliveryDate} · {order.physicalUnits?.find((unit) => unit.tagCode === tag.tagNumber)?.state || "Active"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-5 rounded-2xl border border-[#664cf0]/15 bg-[#f7f5ff] p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#5b45c8]">
            <CircleDollarSign className="h-3.5 w-3.5" />
            Collection ledger
          </p>
          {summary && (
            <span className="text-xs font-bold text-[#4b3bb0]">
              {formatINR(summary.outstanding)} due
            </span>
          )}
        </div>
        {summary && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Total</span>
              <strong>{formatINR(summary.total)}</strong>
            </div>
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Paid</span>
              <strong>{formatINR(summary.paid)}</strong>
            </div>
            <div className="rounded-lg bg-white p-2">
              <span className="block text-[#7b739d]">Status</span>
              <strong>{summary.status}</strong>
            </div>
          </div>
        )}
        {summary?.outstanding ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Amount
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  type="number"
                  min="0.01"
                  max={summary.outstanding}
                  step="0.01"
                  placeholder={String(summary.outstanding)}
                  className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#30265f]"
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Method
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as typeof mode)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#30265f]"
                >
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                  <option>Bank</option>
                </select>
              </label>
            </div>
            {mode === "Cash" && cashShifts.data?.filter((shift) => shift.status === "Open").length ? (
              <label className="mt-2 block text-[10px] font-bold uppercase tracking-[.12em] text-[#6d6594]">
                Cash register
                <select value={cashRegister} onChange={(event) => setCashRegister(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#30265f]"><option value="">{cashShifts.data.filter((shift) => shift.status === "Open").length === 1 ? "Main / only open register" : "Choose an open register"}</option>{cashShifts.data.filter((shift) => shift.status === "Open").map((shift) => <option key={shift.id} value={shift.register}>{shift.register}</option>)}</select>
              </label>
            ) : mode === "Cash" ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] font-semibold text-amber-800">Open a cash register before recording cash.</p> : null}
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Reference / receipt no. (optional)"
              className="mt-2 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs outline-none"
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Collection note (optional)"
              className="mt-2 h-9 w-full rounded-lg border border-[#664cf0]/20 bg-white px-2 text-xs outline-none"
            />
            <button
              type="button"
              disabled={collect.isPending || !Number(amount)}
              onClick={() => collect.mutate()}
              className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#664cf0] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b8afe8]"
            >
              {collect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CircleDollarSign className="h-3.5 w-3.5" />
              )}
              Record collection
            </button>
          </>
        ) : (
          <p className="mt-3 rounded-lg bg-white p-2 text-xs font-semibold text-[#4b3bb0]">
            This invoice is fully settled.
          </p>
        )}
        {summary?.payments.length ? (
          <div className="mt-3 space-y-1.5">
            {summary.payments.map((payment) => (
              <div key={payment.id}>
              <div
                key={payment.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-xs"
              >
                <span>
                  <strong>{formatINR(payment.amount)}</strong> · {payment.mode}
                  <span className="block text-[10px] text-[#8178a8]">
                    {payment.reference || payment.postingDate} ·{" "}
                    {payment.providerStatus}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={reverse.isPending}
                  onClick={() => {
                    setReverseTarget(payment.id);
                    setReverseReason("");
                    setError("");
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-bold text-rose-700 hover:bg-rose-50"
                  title="Reverse collection"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reverse
                </button>
              </div>
              {reverseTarget === payment.id ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2">
                  <input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Reason for reversal" className="h-8 w-full rounded-md border border-rose-200 bg-white px-2 text-xs outline-none focus:border-rose-400" />
                  <div className="mt-2 flex gap-2"><button type="button" onClick={() => setReverseTarget(null)} className="flex-1 rounded-md border border-rose-200 bg-white px-2 py-1.5 text-[10px] font-bold text-rose-700">Keep payment</button><button type="button" disabled={reverse.isPending || !reverseReason.trim()} onClick={() => reverse.mutate({ id: payment.id, reason: reverseReason.trim() })} className="flex-1 rounded-md bg-rose-700 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{reverse.isPending ? "Reversing…" : "Confirm reversal"}</button></div>
                </div>
              ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[10px] leading-4 text-[#756e9a]">
          Manual-safe recording only. UPI/Card entries remain operator-confirmed
          until a provider is configured.
        </p>
      </section>
      {error && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="mt-5 border-t border-[#263f44]/10 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#648077]">
          Timeline
        </p>
        <div className="mt-3 space-y-3">
          {order.timeline.map((entry) => (
            <div key={entry.id} className="flex gap-2 text-xs">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#65a298]" />
              <span>
                <span className="font-semibold text-[#40565a]">
                  {entry.action.replace("laundry:", "").replace(":", " ")}
                </span>
                <span className="block text-[#819094]">
                  {new Date(entry.ts).toLocaleString("en-IN")}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
function StatePill({ state }: { state: LaundryState }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
        stateTone[state],
      )}
    >
      {state}
    </span>
  );
}
function date(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}
async function exportOrders(rows: LaundryOrder[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((order) => ({
      "Invoice no.": order.invoiceNumber,
      "Order no.": order.orderNumber,
      Customer: order.customer.name,
      Phone: order.customer.phone,
      "Order date": order.orderDate,
      "Delivery date": order.expectedDeliveryDate,
      Amount: order.grandTotal,
      "Payment mode": order.paymentMode,
      "Payment status": order.paymentStatus,
      Status: order.state,
      "Fulfilment mode": order.fulfillmentMode,
      Rider: order.deliveryRider?.name || order.pickupRider?.name || "",
    })),
  );
  sheet["!cols"] = [16, 16, 24, 16, 14, 16, 14, 16, 16, 18, 18, 22].map(
    (width) => ({ wch: width }),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Store Orders");
  XLSX.writeFile(
    workbook,
    `laundry-store-orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
    { compression: true },
  );
}
