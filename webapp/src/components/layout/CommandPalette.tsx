import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ALL_DESTINATIONS, type Destination } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

type RecordResult = { kind: 'customer' | 'order' | 'invoice' | 'garment' | 'container'; id: string; label: string; detail: string; path: string };

/** Command palette (Ctrl/Cmd+K) — jump to any module, ERP power-user style. */
export function CommandPalette({ destinations = ALL_DESTINATIONS, recordSearchPath }: { destinations?: Destination[]; recordSearchPath?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const [records, setRecords] = useState<RecordResult[]>([]);
  const [recordSearchError, setRecordSearchError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? destinations.filter(
          (d) => d.label.toLowerCase().includes(term) || d.ws.toLowerCase().includes(term)
        )
      : destinations;
    return list.slice(0, 8);
  }, [q]);

  useEffect(() => setActive(0), [q, open]);
  useEffect(() => {
    if (!recordSearchPath || !open || q.trim().length < 2) { setRecords([]); setRecordSearchError(''); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiGet<RecordResult[]>(`${recordSearchPath}?q=${encodeURIComponent(q.trim())}`).then((result) => { if (!cancelled) { setRecords(result); setRecordSearchError(''); } }).catch((error: Error) => { if (!cancelled) { setRecords([]); setRecordSearchError(error.message || 'Search unavailable'); } });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q, open, recordSearchPath]);

  if (!open) return null;

  const go = (to: string) => {
    nav(to);
    setOpen(false);
    setQ("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-popover shadow-2xl animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Command search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && results[active]) go(results[active].to);
          }}
          placeholder="Jump to… (type a module, e.g. GST, POS, Leads)"
          className="w-full border-b bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {recordSearchPath && q.trim().length >= 2 ? <>
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Workspace records</p>
            {recordSearchError ? <p className="px-3 py-3 text-xs text-destructive">{recordSearchError}</p> : records.map((record) => <button key={`${record.kind}-${record.id}`} onClick={() => go(record.path)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted"><span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{record.kind}</span><span className="min-w-0"><span className="block truncate font-medium">{record.label}</span><span className="block truncate text-xs text-muted-foreground">{record.detail}</span></span></button>)}
            {!recordSearchError && !records.length ? <p className="px-3 py-3 text-xs text-muted-foreground">No matching records.</p> : null}
            <div className="my-2 border-t" />
          </> : null}
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.to}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.to)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm",
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              )}
            >
              <r.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
              <span className="font-medium">{r.label}</span>
              <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">{r.ws}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5">↵</kbd> open</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
