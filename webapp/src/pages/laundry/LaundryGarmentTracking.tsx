import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Box,
  CheckCircle2,
  History,
  Loader2,
  MapPin,
  Printer,
  ScanLine,
  Search,
  Shirt,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, operatorErrorMessage } from "@/lib/api";
import {
  buildLaundryPrintHtml,
  type PrintOrder,
  type PrintSettings,
  type PrintTag,
} from "@/lib/laundryPrint";

type Unit = {
  id: string;
  code: string;
  tagCode: string;
  orderId: string;
  orderNumber: string;
  customer: { name: string; phone: string };
  garment: { name: string };
  service: { name: string };
  unit: string;
  sequence: number;
  state: string;
  location: string;
  condition: string;
  expectedDeliveryDate?: string;
  isOverdue?: boolean;
  eventCount: number;
  reprintCount: number;
};
type UnitDetail = Unit & {
  scanResult?: "accepted" | "already_at_stage";
  events: Array<{
    id: string;
    event: string;
    fromState?: string;
    toState?: string;
    location?: string;
    actor: string;
    note?: string;
    createdAt: string;
  }>;
  reprints: Array<{
    id: string;
    previousTagCode: string;
    newTagCode: string;
    station: string;
    reason: string;
    actor: string;
    createdAt: string;
  }>;
};
type ContainerDetail = {
  scanResult?: "accepted" | "already_at_stage";
  id: string;
  tagCode: string;
  tagPayload: string;
  orderId: string;
  orderNumber: string;
  customer: { id: string; name: string; phone: string };
  sequence: number;
  total: number;
  weightKg?: number;
  state: string;
  location: string;
  condition: string;
  expectedDeliveryDate?: string;
  events: Array<{
    id: string;
    event: string;
    fromState?: string;
    toState?: string;
    location?: string;
    actor: string;
    note?: string;
    createdAt: string;
  }>;
};
type PrintableOrder = PrintOrder & { tags: PrintTag[] };
type RackOccupancy = {
  asOf: string;
  totals: {
    rackedUnits: number;
    locations: number;
    unassignedRackedUnits: number;
    occupiedSlots: number;
    configuredLocations?: number;
    configuredCapacity?: number;
    availableSlots?: number;
    overCapacityLocations?: number;
  };
  locations: Array<{
    location: string;
    occupied: number;
    capacity: number | null;
    available: number | null;
    utilizationPercent: number | null;
    overCapacity: boolean;
    units: Array<{
      id: string;
      tagCode: string;
      orderId: string;
      orderNumber: string;
      customer: string;
      garment: string;
      updatedAt: string;
    }>;
  }>;
};
const states = [
  "Intake",
  "Sorted",
  "Processing",
  "QC",
  "Rewash",
  "Assembly",
  "Racked",
  "Dispatched",
  "Delivered",
  "Missing",
  "Damaged",
  "Cancelled",
];

export default function LaundryGarmentTracking() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [tagCode, setTagCode] = useState("");
  const [scanKind, setScanKind] = useState<"garment" | "container">("garment");
  const [nextState, setNextState] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<UnitDetail | null>(null);
  const [selectedContainer, setSelectedContainer] =
    useState<ContainerDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [fastScan, setFastScan] = useState(true);
  const [scanFeedback, setScanFeedback] = useState<"idle" | "success" | "warning" | "error">("idle");
  const [searchParams] = useSearchParams();
  const units = useQuery({
    queryKey: ["garment-units", search, stateFilter],
    queryFn: () =>
      apiGet<Unit[]>(
        `/laundry/garment-units?search=${encodeURIComponent(search)}${stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ""}`,
      ),
  });
  const occupancy = useQuery({
    queryKey: ["rack-occupancy"],
    queryFn: () => apiGet<RackOccupancy>("/laundry/rack-occupancy"),
  });
  const scan = useMutation({
    mutationFn: (code: string = tagCode) =>
      apiPost<UnitDetail>("/laundry/garment-units/scan", {
        tagCode: code,
        nextState: nextState || undefined,
        location: location || undefined,
        note: note || undefined,
      }),
    onSuccess: (data) => {
      setSelected(data);
      setTagCode(data.tagCode);
      setNextState("");
      setNotice("Scan recorded in the garment audit trail.");
      setScanFeedback(data.scanResult === "already_at_stage" ? "warning" : "success");
      client.invalidateQueries({ queryKey: ["garment-units"] });
    },
    onError: () => setScanFeedback("error"),
  });
  const containerScan = useMutation({
    mutationFn: (code: string = tagCode) =>
      apiPost<ContainerDetail>("/laundry/containers/scan", {
        tagCode: code,
        nextState: nextState || undefined,
        location: location || undefined,
        note: note || undefined,
      }),
    onSuccess: (data) => {
      setSelectedContainer(data);
      setSelected(null);
      setTagCode(data.tagCode);
      setNextState("");
      setNotice("Scan recorded in the container audit trail.");
      setScanFeedback(data.scanResult === "already_at_stage" ? "warning" : "success");
    },
    onError: () => setScanFeedback("error"),
  });
  const inspect = useMutation({
    mutationFn: (id: string) =>
      apiGet<UnitDetail>(`/laundry/garment-units/${id}`),
    onSuccess: (data) => {
      setSelected(data);
      setTagCode(data.tagCode);
      setNotice("");
    },
  });
  const reprint = useMutation({
    mutationFn: async () => {
      const data = await apiPost<UnitDetail>(
        `/laundry/garment-units/${selected?.id}/reprint`,
        { station: "Counter", reason: note },
      );
      const print = await printTagForUnit(data.orderId, data.id, data.tagCode);
      if (!print.ok)
        throw new Error(
          "Same-tag reprint was recorded, but the print command could not be started. Use Print Centre to retry.",
        );
      return { data, print };
    },
    onSuccess: ({ data, print }) => {
      setSelected(data);
      setTagCode(data.tagCode);
      setNote("");
      setNotice(
        print.auditRecorded
          ? "Same tag printed again. Identity preserved and the reprint is in the audit trail."
          : "Same tag printed again, but print history could not be saved. Retry from Print Centre if needed.",
      );
    },
  });
  const replace = useMutation({
    mutationFn: async () => {
      const data = await apiPost<UnitDetail>(
        `/laundry/garment-units/${selected?.id}/replace-tag`,
        { station: "Counter", reason: note },
      );
      const print = await printTagForUnit(data.orderId, data.id, data.tagCode);
      if (!print.ok)
        throw new Error(
          "Tag replacement was recorded, but the new tag could not be printed. Use Print Centre to retry.",
        );
      return { data, print };
    },
    onSuccess: ({ data, print }) => {
      setSelected(data);
      setTagCode(data.tagCode);
      setNote("");
      setNotice(
        print.auditRecorded
          ? "Tag replaced and the new active tag was printed. The previous tag is retired and will be rejected if scanned."
          : "Tag replaced and printed, but print history could not be saved. Retry from Print Centre if needed.",
      );
    },
  });
  const error =
    scan.error ||
    containerScan.error ||
    reprint.error ||
    replace.error ||
    inspect.error;
  useEffect(() => {
    const tag = searchParams.get("tag");
    if (tag) {
      setTagCode(tag);
      setSearch(tag);
      const kind = searchParams.get("kind");
      if (kind === "container") setScanKind("container");
      if (searchParams.get("scan") === "1") window.setTimeout(() => { if (kind === "container") containerScan.mutate(tag); else scan.mutate(tag); }, 0);
    }
  }, [searchParams]);
  const scanStates =
    scanKind === "container"
      ? [
          "Intake",
          "Processing",
          "Ready",
          "Dispatched",
          "Delivered",
          "Missing",
          "Damaged",
          "Cancelled",
        ]
      : states;
  const doScan = (code = tagCode) => {
    if (!code.trim()) return;
    setScanFeedback("idle");
    if (scanKind === "container") containerScan.mutate(code.trim());
    else scan.mutate(code.trim());
  };
  useEffect(() => {
    if (!fastScan) return;
    const onScan = (event: Event) => {
      const code = String((event as CustomEvent<{ code?: string }>).detail?.code || '').trim();
      if (!code) return;
      const normalized = code.toUpperCase();
      if (!normalized.startsWith('ELT-') && !normalized.startsWith('GU-') && !normalized.startsWith('ELB-')) return;
      event.preventDefault();
      const isContainer = normalized.startsWith('ELB-');
      if (isContainer && scanKind !== 'container') setScanKind('container');
      if (!isContainer && scanKind === 'container' && code.toUpperCase().startsWith('ELB-') === false) setScanKind('garment');
      if (isContainer) containerScan.mutate(code); else scan.mutate(code);
    };
    window.addEventListener('epic-global-scan', onScan);
    return () => window.removeEventListener('epic-global-scan', onScan);
  }, [fastScan, scanKind, nextState, location, note, scan, containerScan]);
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
            Production traceability
          </p>
          <h1 className="mt-1 font-serif text-3xl text-[#17353c]">
            Garment tracking
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#718087]">
            Scan the opaque tag at every handoff. Each state change, location,
            exception, and reprint is retained for the order audit.
          </p>
        </div>
        <div className="rounded-2xl border border-[#39786f]/20 bg-[#eaf3ef] px-4 py-3 text-xs font-semibold text-[#2e6a60]">
          <ScanLine className="mr-2 inline h-4 w-4" />
          No customer data is encoded in tags
        </div>
      </div>
      <section className="mt-6 rounded-[24px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f5f7f3] px-3 py-2.5"><div><p className="text-xs font-bold text-[#315d57]">Fast-scan station</p><p className="text-[10px] text-[#718087]">Keyboard-wedge scanners can scan without focusing the code field.</p></div><label className="flex items-center gap-2 text-xs font-bold text-[#315d57]"><input type="checkbox" checked={fastScan} onChange={(event) => setFastScan(event.target.checked)} className="h-4 w-4 accent-[#3a7d78]" />Global listener {fastScan ? "on" : "off"}</label></div>
        <div className="mb-4 flex gap-1 rounded-xl bg-[#f2f5f1] p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setScanKind("garment");
              setNextState("");
              setSelectedContainer(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 ${scanKind === "garment" ? "bg-white text-[#215861] shadow-sm" : "text-[#718087]"}`}
          >
            <Shirt className="mr-1.5 inline h-3.5 w-3.5" />
            Garment tag
          </button>
          <button
            type="button"
            onClick={() => {
              setScanKind("container");
              setNextState("");
              setSelected(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 ${scanKind === "container" ? "bg-white text-[#704f19] shadow-sm" : "text-[#718087]"}`}
          >
            <Box className="mr-1.5 inline h-3.5 w-3.5" />
            Bag / container tag
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_150px] xl:grid-cols-[minmax(0,1.5fr)_180px_180px_auto]">
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            {scanKind === "container"
              ? "Container tag or code"
              : "Tag or unit code"}
            <input
              autoFocus
              value={tagCode}
              onChange={(e) => setTagCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagCode.trim()) doScan(tagCode);
              }}
              placeholder={
                scanKind === "container"
                  ? "ELB-20260830-000001"
                  : "GU-20260829-000001"
              }
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-[#fffdf8] px-3 text-sm font-semibold tracking-wide text-[#17353c]"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Move to
            <select
              value={nextState}
              onChange={(e) => setNextState(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-[#fffdf8] px-3 text-sm font-medium normal-case tracking-normal"
            >
              <option value="">Inspect only</option>
              {scanStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Location
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Steam station"
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-[#fffdf8] px-3 text-sm font-medium normal-case tracking-normal"
            />
          </label>
          <button
            disabled={
              !tagCode.trim() || scan.isPending || containerScan.isPending
            }
            onClick={() => doScan()}
            className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#123039] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scan.isPending || containerScan.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="h-4 w-4" />
            )}
            Scan tag
          </button>
        </div>
        <label className="mt-3 block max-w-2xl text-xs font-semibold text-[#617178]">
          Operator note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional handoff note or exception detail"
            className="mt-1.5 h-10 w-full rounded-xl border border-[#263f44]/15 bg-[#fffdf8] px-3 text-sm font-normal"
          />
        </label>
          {notice ? (
          <p className="mt-3 text-sm font-semibold text-[#2e6a60]">
            <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
            {notice}
          </p>
          ) : null}
          {scanFeedback !== "idle" ? <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${scanFeedback === "success" ? "bg-[#eaf3ef] text-[#2e6a60]" : scanFeedback === "warning" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>{scanFeedback === "success" ? "Green · scan accepted and recorded" : scanFeedback === "warning" ? "Amber · already at this stage; duplicate scan recorded" : "Red · scan rejected; no state change was recorded"}</p> : null}
        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {operatorErrorMessage(error, "The tracking action could not be saved.")}
          </p>
        ) : null}
      </section>
      {selected ? (
        <Detail
          unit={selected}
          note={note}
          pending={reprint.isPending || replace.isPending}
          onReprint={() => reprint.mutate()}
          onReplace={() => replace.mutate()}
        />
      ) : null}
      {selectedContainer ? (
        <ContainerDetailPanel container={selectedContainer} />
      ) : null}
      {occupancy.data ? <RackOccupancyPanel data={occupancy.data} /> : null}
      {occupancy.data ? <RackCapacitySummary data={occupancy.data} /> : null}
      <section className="mt-6 overflow-hidden rounded-[24px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <header className="flex flex-col gap-3 border-b border-[#263f44]/10 bg-[#fafaf7] p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
              Physical inventory
            </p>
            <h2 className="mt-1 font-serif text-2xl text-[#17353c]">
              Active garment units
            </h2>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#819095]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tag, order, unit"
                className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-white pl-9 pr-3 text-sm sm:w-64"
              />
            </label>
            <label className="relative block">
              <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#819095]" />
              <select
                aria-label="Filter garment state"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="h-10 w-full rounded-xl border border-[#263f44]/15 bg-white pl-9 pr-8 text-sm sm:w-40"
              >
                <option value="">All states</option>
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        {units.isLoading ? (
          <div className="grid h-32 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-[#3a7d78]" />
          </div>
        ) : units.data?.length ? (
          <div className="divide-y divide-[#263f44]/8">
            {units.data.map((unit) => (
              <button
                type="button"
                key={unit.id}
                onClick={() => inspect.mutate(unit.id)}
                className="flex w-full flex-col gap-3 p-5 text-left transition hover:bg-[#f8faf7] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3ef] text-[#39786f]">
                    <Shirt className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-bold text-[#215861]">{unit.tagCode}</p>
                    <p className="mt-0.5 text-sm font-medium text-[#253c40]">
                      {unit.garment.name} · {unit.service.name}{" "}
                      <span className="font-normal text-[#718087]">
                        · {unit.customer.name}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-[#819095]">
                      <MapPin className="mr-1 inline h-3 w-3" />
                      {unit.orderNumber} · {unit.location} · {unit.eventCount}{" "}
                      events
                      {unit.reprintCount
                        ? ` · ${unit.reprintCount} reprint${unit.reprintCount === 1 ? "" : "s"}`
                        : ""}
                      {unit.expectedDeliveryDate
                        ? ` · due ${unit.expectedDeliveryDate}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${unit.state === "Delivered" ? "bg-[#eaf3ef] text-[#2e6a60]" : unit.state === "Damaged" || unit.state === "Missing" ? "bg-rose-50 text-rose-700" : "bg-[#fff2ce] text-[#855815]"}`}
                  >
                    {unit.state}
                  </span>
                  {unit.isOverdue ? (
                    <span className="text-[10px] font-bold uppercase tracking-[.1em] text-rose-700">
                      SLA overdue
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-[#718087]">
            <Box className="mx-auto mb-3 h-7 w-7 text-[#aab8b2]" />
            No physical garment units match this search.
          </div>
        )}
      </section>
    </div>
  );
}

async function printTagForUnit(
  orderId: string,
  unitId: string,
  tagCode: string,
): Promise<{ ok: boolean; auditRecorded: boolean }> {
  const [order, settings] = await Promise.all([
    apiGet<PrintableOrder>(`/laundry/orders/${encodeURIComponent(orderId)}`),
    apiGet<PrintSettings>("/laundry/print-settings").catch(
      () => ({}) as PrintSettings,
    ),
  ]);
  const tag = order.tags.find(
    (candidate) =>
      candidate.unitId === unitId || candidate.tagNumber === tagCode,
  );
  if (!tag)
    throw new Error(
      "The active tag is not available in the selected order print set.",
    );
  const html = await buildLaundryPrintHtml("tags", order, settings, [tag]);
  const result = await window.epic?.printHtml?.(html);
  let ok = Boolean(result?.ok);
  if (!result) {
    const popup = window.open("", "_blank", "width=900,height=1100");
    if (popup) {
      popup.document.write(
        `${html}<script>window.onload=()=>window.print()<\/script>`,
      );
      popup.document.close();
      ok = true;
    }
  }
  let auditRecorded = false;
  try {
    await apiPost("/laundry/print-jobs", {
      orderId,
      templateId: "recommended-a4-6",
      templateVersion: "1",
      printerProfile: settings.printerProfile || "system-default",
      tagIds: [unitId],
      documentType: "garment-tags",
      requestedCopies: 1,
      status: ok ? "Printed" : "Cancelled",
      evidence: ok
        ? "Native print command accepted; physical output not independently verified"
        : "Operator cancelled or print command failed",
    });
    auditRecorded = true;
  } catch {
    /* the tag lifecycle command is already durable; the caller reports the missing audit record */
  }
  return { ok, auditRecorded };
}

function ContainerDetailPanel({ container }: { container: ContainerDetail }) {
  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_1fr]">
      <article className="rounded-[24px] border border-[#d7c38e]/60 bg-[#fff8e8] p-6 shadow-[0_8px_28px_rgba(37,48,43,.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#9b6d1d]">
              Selected container
            </p>
            <h2 className="mt-1 font-serif text-2xl text-[#17353c]">
              {container.tagCode}
            </h2>
            <p className="mt-1 text-sm text-[#6d5a2d]">
              {container.orderNumber} · {container.customer.name}
            </p>
          </div>
          <span className="rounded-full bg-[#e8bf68] px-3 py-1 text-xs font-bold text-[#17363e]">
            {container.state}
          </span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-[#5c5d4e]">
          <MetricDark
            label="Sequence"
            value={`${container.sequence} / ${container.total}`}
          />
          <MetricDark
            label="Weight"
            value={
              container.weightKg === undefined
                ? "Bulk container"
                : `${container.weightKg} kg`
            }
          />
          <MetricDark label="Location" value={container.location} />
          <MetricDark label="Condition" value={container.condition} />
        </div>
        <p className="mt-6 text-xs text-[#8b7448]">
          Container identity is separate from garment-piece tags. Scan it at
          bulk intake, processing, ready, dispatch, and delivery handoffs.
        </p>
      </article>
      <article className="rounded-[24px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-[#39786f]" />
          <h2 className="font-serif text-2xl text-[#17353c]">
            Container audit trail
          </h2>
        </div>
        <div className="mt-5 max-h-64 space-y-4 overflow-auto pr-2">
          {container.events
            .slice()
            .reverse()
            .map((event) => (
              <div
                key={event.id}
                className="relative border-l-2 border-[#d7c38e] pl-4"
              >
                <p className="text-sm font-bold text-[#704f19]">
                  {event.event === "state_transition"
                    ? `${event.fromState} → ${event.toState}`
                    : event.event.replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-xs text-[#718087]">
                  {event.location || "—"} · {event.actor} ·{" "}
                  {new Date(event.createdAt).toLocaleString("en-IN")}
                </p>
                {event.note ? (
                  <p className="mt-1 text-xs text-[#52676b]">{event.note}</p>
                ) : null}
              </div>
            ))}
        </div>
      </article>
    </section>
  );
}
function MetricDark({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#9b6d1d]">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-[#5c5d4e]">{value}</p>
    </div>
  );
}

function Detail({
  unit,
  note,
  pending,
  onReprint,
  onReplace,
}: {
  unit: UnitDetail;
  note: string;
  pending: boolean;
  onReprint: () => void;
  onReplace: () => void;
}) {
  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_1fr]">
      {" "}
      <article className="rounded-[24px] border border-[#263f44]/10 bg-[#123039] p-6 text-[#eaf0e9] shadow-[0_8px_28px_rgba(37,48,43,.08)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#a8c4bc]">
              Selected unit
            </p>
            <h2 className="mt-1 font-serif text-2xl">{unit.tagCode}</h2>
            <p className="mt-1 text-sm text-[#bfd0c9]">
              {unit.garment.name} · {unit.service.name} · {unit.customer.name}
            </p>
          </div>
          <span className="rounded-full bg-[#e8bf68] px-3 py-1 text-xs font-bold text-[#17363e]">
            {unit.state}
          </span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <Metric label="Order" value={unit.orderNumber} />
          <Metric label="Location" value={unit.location} />
          <Metric label="Condition" value={unit.condition} />
          <Metric label="Events" value={String(unit.events.length)} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            disabled={pending || note.trim().length < 3}
            onClick={onReprint}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#17363e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {pending ? "Working…" : "Print again"}
          </button>
          <button
            disabled={pending || note.trim().length < 3}
            onClick={onReplace}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e8bf68]/60 px-4 py-2.5 text-sm font-bold text-[#f3d48e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Replace tag
          </button>
        </div>
        <p className="mt-2 text-xs text-[#a8c4bc]">
          Print again preserves this tag. Replace retires it and creates a new
          active tag. Both require a reason.
        </p>
      </article>
      <article className="rounded-[24px] border border-[#263f44]/10 bg-white p-6 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-[#39786f]" />
          <h2 className="font-serif text-2xl text-[#17353c]">Audit trail</h2>
        </div>
        <div className="mt-5 max-h-64 space-y-4 overflow-auto pr-2">
          {unit.events
            .slice()
            .reverse()
            .map((event) => (
              <div
                key={event.id}
                className="relative border-l-2 border-[#cfe1d9] pl-4"
              >
                <p className="text-sm font-bold text-[#215861]">
                  {event.event === "state_transition"
                    ? `${event.fromState} → ${event.toState}`
                    : event.event.replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-xs text-[#718087]">
                  {event.location || "—"} · {event.actor} ·{" "}
                  {new Date(event.createdAt).toLocaleString("en-IN")}
                </p>
                {event.note ? (
                  <p className="mt-1 text-xs text-[#52676b]">{event.note}</p>
                ) : null}
              </div>
            ))}
        </div>
        {unit.reprints.length ? (
          <div className="mt-5 rounded-xl bg-[#fff8e8] p-3 text-xs text-[#855815]">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {unit.reprints.length} tag print/replacement event
            {unit.reprints.length === 1 ? "" : "s"} recorded.
          </div>
        ) : null}
      </article>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#a8c4bc]">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold">{value}</p>
    </div>
  );
}

function RackOccupancyPanel({ data }: { data: RackOccupancy }) {
  return (
    <section className="mt-6 rounded-[24px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-[#39786f]" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">
            Physical retrieval
          </p>
          <h2 className="font-serif text-2xl text-[#17353c]">
            Rack & bin occupancy
          </h2>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Racked units"
          value={String(data.totals.rackedUnits)}
        />
        <MetricCard
          label="Occupied locations"
          value={String(data.totals.locations)}
        />
        <MetricCard
          label="Occupied slots"
          value={String(data.totals.occupiedSlots)}
        />
        <MetricCard
          label="Unassigned"
          value={String(data.totals.unassignedRackedUnits)}
        />
      </div>
      {data.locations.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.locations.map((location) => (
            <article
              key={location.location}
              className="rounded-xl border border-[#263f44]/8 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold text-[#315d57]">
                  {location.location}
                </p>
                <span className="rounded-full bg-[#eaf3ef] px-2 py-1 text-[10px] font-bold text-[#2e6a60]">
                  {location.occupied} unit{location.occupied === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {location.units.slice(0, 5).map((unit) => (
                  <p
                    key={unit.id}
                    className="truncate text-[11px] text-[#617178]"
                  >
                    <span className="font-mono font-semibold text-[#315d57]">
                      {unit.tagCode}
                    </span>{" "}
                    · {unit.garment} · {unit.orderNumber}
                  </p>
                ))}
                {location.occupied > location.units.length ? (
                  <p className="text-[10px] text-[#819095]">
                    +{location.occupied - location.units.length} more units
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-[#718087]">
          No garments are currently recorded in a rack or bin.
        </p>
      )}
      <p className="mt-4 text-[10px] text-[#819095]">
        Occupancy is derived from durable Racked units; capacity is not claimed
        until a physical rack profile is configured.
      </p>
    </section>
  );
}

function RackCapacitySummary({ data }: { data: RackOccupancy }) {
  if (!data.totals.configuredLocations) return null;
  return (
    <section className="mt-4 rounded-2xl border border-[#39786f]/15 bg-[#eaf3ef] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#39786f]">
        Capacity control
      </p>
      <p className="mt-1 text-sm font-semibold text-[#215861]">
        {data.totals.availableSlots ?? 0} slots available across{" "}
        {data.totals.configuredLocations} configured location
        {data.totals.configuredLocations === 1 ? "" : "s"}.
      </p>
      {data.totals.overCapacityLocations ? (
        <p className="mt-1 text-xs font-bold text-rose-700">
          {data.totals.overCapacityLocations} location
          {data.totals.overCapacityLocations === 1 ? "" : "s"} exceed configured
          capacity. Resolve before assigning more garments.
        </p>
      ) : (
        <p className="mt-1 text-xs text-[#52716b]">
          All configured locations are within their owner-defined physical
          limits.
        </p>
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#263f44]/8 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#819095]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-[#215861]">{value}</p>
    </div>
  );
}
