import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPinned,
  BarChart3,
  Play,
  Route as RouteIcon,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import type { LaundryOrder } from "@/lib/laundry";

type Rider = { id: string; name: string; phone: string };
type Session = { user: { roles: string[]; riderId?: string | null } | null };
type DispatchData = {
  riders: Rider[];
  pickups: LaundryOrder[];
  deliveries: LaundryOrder[];
};
type Route = {
  id: string;
  riderId: string;
  riderName: string;
  routeDate: string;
  stage: "Pickup" | "Delivery";
  zone?: string;
  startTime?: string;
  minutesPerStop?: number;
  status: string;
  stopCount: number;
  notes: string;
  stops: Array<{
    id: string;
    sequence: number;
    orderId: string;
    orderNumber: string;
    address: string;
    estimatedAt?: string;
    status: string;
    note: string;
  }>;
};
type RouteAnalytics = { totals: { orders: number; zones: number; routes: number; activeRoutes: number; stops: number; completedStops: number; completionPercent: number }; zones: Array<{ zone: string; orders: number; pickupReady: number; deliveryReady: number; assigned: number; activeRuns: number }> };

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#263f44]/8 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#819095]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#215861]">{value}</p>
    </div>
  );
}

export default function LaundryRoutes() {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["auth-session"], queryFn: () => apiGet<Session>("/auth/session") });
  const riderMode = Boolean(session.data?.user?.roles.includes("rider"));
  const [stage, setStage] = useState<"Pickup" | "Delivery">("Pickup");
  const [rider, setRider] = useState("");
  const [routeDate, setRouteDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [zone, setZone] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [minutesPerStop, setMinutesPerStop] = useState("15");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const dispatch = useQuery({
    queryKey: ["laundry-dispatch"],
    queryFn: () => apiGet<DispatchData>("/laundry/dispatch"),
    enabled: !riderMode,
  });
  const routes = useQuery({
    queryKey: ["laundry-routes"],
    queryFn: () => apiGet<Route[]>("/laundry/routes"),
  });
  const analytics = useQuery({
    queryKey: ["laundry-route-analytics", riderMode],
    queryFn: () => apiGet<RouteAnalytics>("/laundry/route-analytics"),
  });
  const serviceZones = useQuery({
    queryKey: ["laundry-service-zones"],
    queryFn: () => apiGet<string[]>("/laundry/service-zones"),
    enabled: !riderMode,
  });
  const orders =
    stage === "Pickup"
      ? dispatch.data?.pickups || []
      : dispatch.data?.deliveries || [];
  const create = useMutation({
    mutationFn: () =>
      apiPost<Route>("/laundry/routes", {
        riderId: rider,
        stage,
        routeDate,
        zone: zone.trim(),
        startTime,
        minutesPerStop: Number(minutesPerStop) || 15,
        orderIds: selected,
      }),
    onSuccess: (data) => {
      setSelected([]);
      setZone("");
      setNotice(
        `${data.id} created with ${data.stopCount} stops${data.zone ? ` in ${data.zone}` : ""}.`,
      );
      client.invalidateQueries({ queryKey: ["laundry-routes"] });
    },
  });
  const start = useMutation({
    mutationFn: (id: string) => apiPost<Route>(`/laundry/routes/${id}/start`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["laundry-routes"] }),
  });
  const complete = useMutation({
    mutationFn: ({
      routeId,
      stopId,
      status,
      note,
    }: {
      routeId: string;
      stopId: string;
      status: "Completed" | "Skipped";
      note?: string;
    }) =>
      apiPost<Route>(`/laundry/routes/${routeId}/stops/${stopId}/complete`, {
        status,
        note: note || "",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["laundry-routes"] }),
  });
  const active = useMemo(
    () =>
      (routes.data || []).filter((route) =>
        ["Planned", "In Progress"].includes(route.status),
      ),
    [routes.data],
  );
  if (session.isLoading || routes.isLoading || (!riderMode && dispatch.isLoading))
    return (
      <div className="grid h-80 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" />
      </div>
    );
  if (routes.isError || (!riderMode && (dispatch.isError || !dispatch.data)) || !routes.data)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        Route planning could not be loaded.
      </div>
    );
  if (riderMode)
    return (
      <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Field operations</p>
          <h1 className="mt-1 font-serif text-3xl text-[#17353c]">My route runs</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#718087]">Only routes assigned to your linked rider profile are shown. Start the run and close each stop with an auditable handoff.</p>
        </div>
        {!session.data?.user?.riderId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">This rider account is not linked to an active rider record. Ask an owner to link it before attempting route work.</div> : null}
        <section className="space-y-4">
          {active.length ? active.map((route) => <RouteCard key={route.id} route={route} starting={start.isPending} completing={complete.isPending} onStart={() => start.mutate(route.id)} onComplete={(stopId, status, note) => complete.mutate({ routeId: route.id, stopId, status, note })} />) : <div className="rounded-[24px] border border-[#263f44]/10 bg-white p-14 text-center text-sm text-[#718087]"><ClipboardList className="mx-auto mb-3 h-7 w-7 text-[#aab8b2]" />No active route runs assigned to you.</div>}
        </section>
      </div>
    );
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">
          Field operations
        </p>
        <h1 className="mt-1 font-serif text-3xl text-[#17353c]">Route runs</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#718087]">
          Bundle assigned pickup or delivery orders into a run, start the route,
          and close each stop with an auditable handoff.
        </p>
      </div>
      {analytics.data ? <section className="rounded-[24px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#39786f]" /><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#4d8982]">Coverage analytics</p><h2 className="font-serif text-xl text-[#17353c]">Route workload</h2></div></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><RouteMetric label="Ready orders" value={String(analytics.data.totals.orders)} /><RouteMetric label="Zones" value={String(analytics.data.totals.zones)} /><RouteMetric label="Active runs" value={String(analytics.data.totals.activeRoutes)} /><RouteMetric label="Stop completion" value={`${analytics.data.totals.completionPercent}%`} /></div>{analytics.data.zones.length ? <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{analytics.data.zones.slice(0, 8).map((item) => <div key={item.zone} className="rounded-xl border border-[#263f44]/8 bg-white p-3"><p className="truncate text-sm font-bold text-[#315d57]">{item.zone}</p><p className="mt-1 text-xs text-[#718087]">{item.pickupReady} pickup · {item.deliveryReady} delivery ready</p><p className="mt-1 text-[10px] font-semibold text-[#819095]">{item.activeRuns} active run{item.activeRuns === 1 ? '' : 's'} · {item.assigned} assigned</p></div>)}</div> : <p className="mt-4 text-xs text-[#718087]">No service-zone workload is recorded yet.</p>}</section> : null}
      <section className="rounded-[24px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
        <div className="flex items-center gap-2">
          <RouteIcon className="h-5 w-5 text-[#39786f]" />
          <h2 className="font-serif text-xl text-[#17353c]">Build a route</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-7">
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Stage
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as "Pickup" | "Delivery");
                setSelected([]);
              }}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            >
              <option>Pickup</option>
              <option>Delivery</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Rider
            <select
              value={rider}
              onChange={(e) => setRider(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            >
              <option value="">Select rider</option>
              {(dispatch.data?.riders || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Service zone
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value.slice(0, 120))}
              placeholder="North • Downtown"
              list="laundry-service-zones"
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            />
            <datalist id="laundry-service-zones">{(serviceZones.data || []).map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Route date
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Start time
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-[.12em] text-[#617178]">
            Minutes / stop
            <input
              type="number"
              min="1"
              max="240"
              value={minutesPerStop}
              onChange={(e) => setMinutesPerStop(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[#263f44]/15 bg-white px-3 text-sm font-medium normal-case tracking-normal"
            />
          </label>
          <button
            type="button"
            disabled={create.isPending || !rider || !selected.length}
            onClick={() => create.mutate()}
            className="self-end rounded-xl bg-[#123039] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {create.isPending
              ? "Creating…"
              : `Create ${stage.toLowerCase()} route`}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[#81908f]">
          Stops are validated to one service zone; leave blank to inherit the
          selected orders’ zone.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {orders.length ? (
            orders.map((order) => (
              <label
                key={order.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#263f44]/10 p-3 hover:bg-[#f8faf7]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(order.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, order.id]
                        : current.filter((id) => id !== order.id),
                    )
                  }
                  className="mt-1 accent-[#39786f]"
                />
                <span>
                  <span className="block text-sm font-bold text-[#215861]">
                    {order.orderNumber} · {order.customer.name}
                  </span>
                  <span className="mt-1 block text-xs text-[#718087]">
                    {order.deliveryAddress || "Address not provided"} ·{" "}
                    {order.serviceZone ? `${order.serviceZone} · ` : ""}
                    {order.state}
                  </span>
                </span>
              </label>
            ))
          ) : (
            <p className="rounded-xl bg-[#f8faf7] p-4 text-sm text-[#718087]">
              No eligible {stage.toLowerCase()} orders are waiting.
            </p>
          )}
        </div>
        {create.isError ? (
          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create route."}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-sm font-semibold text-[#2e6a60]">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            {notice}
          </p>
        ) : null}
      </section>
      <section className="space-y-4">
        {active.length ? (
          active.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              starting={start.isPending}
              completing={complete.isPending}
              onStart={() => start.mutate(route.id)}
              onComplete={(stopId, status, note) =>
                complete.mutate({ routeId: route.id, stopId, status, note })
              }
            />
          ))
        ) : (
          <div className="rounded-[24px] border border-[#263f44]/10 bg-white p-14 text-center text-sm text-[#718087]">
            <ClipboardList className="mx-auto mb-3 h-7 w-7 text-[#aab8b2]" />
            No active route runs.
          </div>
        )}
      </section>
    </div>
  );
}
function RouteCard({
  route,
  starting,
  completing,
  onStart,
  onComplete,
}: {
  route: Route;
  starting: boolean;
  completing: boolean;
  onStart: () => void;
  onComplete: (
    stopId: string,
    status: "Completed" | "Skipped",
    note?: string,
  ) => void;
}) {
  return (
    <article className="overflow-hidden rounded-[24px] border border-[#263f44]/10 bg-white shadow-[0_8px_28px_rgba(37,48,43,.04)]">
      <header className="flex flex-col gap-3 border-b border-[#263f44]/10 bg-[#fafaf7] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-[#39786f]" />
            <p className="font-bold text-[#215861]">
              {route.id} · {route.stage}
            </p>
            <span className="rounded-full bg-[#fff2ce] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#855815]">
              {route.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#718087]">
            {route.riderName} · {route.routeDate} · {route.stopCount} stops{route.zone ? ` · ${route.zone}` : ""} · ETA from {route.startTime || "09:00"}
          </p>
        </div>
        {route.status === "Planned" ? (
          <button
            type="button"
            disabled={starting}
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3a7d78] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Start route
          </button>
        ) : null}
      </header>
      <div className="divide-y divide-[#263f44]/8">
        {route.stops.map((stop) => (
          <div
            key={stop.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eaf3ef] text-xs font-bold text-[#39786f]">
                {stop.sequence}
              </span>
              <div>
                <p className="text-sm font-bold text-[#215861]">
                  {stop.orderNumber}
                </p>
                <p className="text-xs text-[#718087]">
                  {stop.address || "No address recorded"}
                </p>
                {stop.estimatedAt ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[#39786f]">ETA {stop.estimatedAt.replace("T", " ")}</p> : null}
              </div>
            </div>
            {stop.status === "Planned" && route.status === "In Progress" ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => onComplete(stop.id, "Completed")}
                  className="rounded-lg bg-[#eaf3ef] px-3 py-2 text-xs font-bold text-[#2e6a60]"
                >
                  Complete
                </button>
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => {
                    const note = window.prompt(
                      "Why is this stop being skipped?",
                    );
                    if (note?.trim())
                      onComplete(stop.id, "Skipped", note.trim());
                  }}
                  className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"
                >
                  Skip
                </button>
              </div>
            ) : (
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${stop.status === "Completed" ? "bg-[#eaf3ef] text-[#2e6a60]" : stop.status === "Skipped" ? "bg-rose-50 text-rose-700" : "bg-[#f3f5f1] text-[#718087]"}`}
              >
                {stop.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}
