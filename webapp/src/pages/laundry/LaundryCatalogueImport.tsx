import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileJson, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { apiPost } from '@/lib/api'

type CataloguePayload = { categories?: unknown[]; services?: unknown[]; garments?: unknown[]; prices?: unknown[]; chargeRules?: unknown[]; discountRules?: unknown[]; taxRules?: unknown[] }
type ImportResult = { created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }>; job?: { id: string; status: string } }

const keys = ['categories', 'services', 'garments', 'prices', 'chargeRules', 'discountRules', 'taxRules'] as const

export default function LaundryCatalogueImport() {
  const client = useQueryClient()
  const [fileName, setFileName] = useState('')
  const [payload, setPayload] = useState<CataloguePayload | null>(null)
  const [parseError, setParseError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const mutation = useMutation({
    mutationFn: (input: CataloguePayload) => apiPost<ImportResult>('/laundry/catalogue/import', input),
    onSuccess: (next) => { setResult(next); client.invalidateQueries({ queryKey: ['laundry-catalogue'] }); client.invalidateQueries({ queryKey: ['store-settings'] }); client.invalidateQueries({ queryKey: ['setup-progress'] }); client.invalidateQueries({ queryKey: ['laundry-import-jobs'] }) },
  })
  async function choose(file?: File) {
    if (!file) return
    setFileName(file.name); setPayload(null); setResult(null); setParseError('')
    if (file.size > 5_000_000) { setParseError('Catalogue JSON must be under 5 MB.'); return }
    try {
      const parsed = JSON.parse(await file.text()) as CataloguePayload
      if (!parsed || typeof parsed !== 'object' || !keys.some((key) => Array.isArray(parsed[key]))) throw new Error('Use a catalogue object containing one or more supported arrays: categories, services, garments, prices, chargeRules, discountRules, taxRules.')
      setPayload(parsed)
    } catch (error) { setParseError(error instanceof Error ? error.message : 'The catalogue file could not be read.') }
  }
  const counts = payload ? keys.map((key) => [key, Array.isArray(payload[key]) ? payload[key]!.length : 0] as const).filter(([, count]) => count > 0) : []
  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-500"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">Owner-only master data</p><h1 className="mt-1 font-serif text-3xl text-[#17353c]">Import complete catalogue</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[#718087]">Merge an exported Epic catalogue or a reviewed owner-owned JSON file into this branch. References resolve by scoped ID or name, prices retain their rule provenance, and any failure rolls the branch back to its pre-import snapshot.</p>
    <section className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="rounded-[24px] border border-dashed border-[#4d8982]/40 bg-[#f6faf7] p-6"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#dceee8] text-[#276e65]"><FileJson className="h-5 w-5" /></span><h2 className="mt-4 font-serif text-2xl text-[#17353c]">Choose catalogue JSON</h2><p className="mt-1 text-sm text-[#718087]">Accepted arrays: categories, services, garments, prices, chargeRules, discountRules and taxRules. Existing records are updated by scoped ID or name; new records are created.</p><label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#123039] px-4 py-2.5 text-sm font-bold text-white"><Upload className="h-4 w-4" /> Select JSON<input aria-label="Select catalogue JSON" type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} /></label>{fileName ? <p className="mt-4 text-sm font-semibold text-[#315f5b]">{fileName}</p> : null}{parseError ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{parseError}</p> : null}{mutation.isError ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{mutation.error instanceof Error ? mutation.error.message : 'The catalogue import failed.'}</p> : null}</div><aside className="rounded-[24px] bg-[#123039] p-6 text-[#edf3ec]"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#f1ca75]">Import guardrails</p><ul className="mt-4 grid gap-3 text-sm leading-5 text-[#c8dcd4]"><li>Owner permission and branch scope are required.</li><li>All references are validated before commit.</li><li>Failure restores the complete branch snapshot.</li><li>Every successful import creates an audit and import-job record.</li></ul></aside></section>
    {payload ? <section className="mt-5 rounded-[24px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-serif text-xl text-[#17353c]">Review import scope</h2><p className="mt-1 text-xs text-[#718087]">No write occurs until you explicitly confirm this reviewed file.</p></div><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(payload)} className="inline-flex items-center gap-2 rounded-xl bg-[#3a7d78] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{mutation.isPending ? 'Importing…' : 'Import reviewed catalogue'}</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{counts.map(([name, count]) => <div key={name} className="rounded-xl bg-[#f6faf7] p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#718087]">{name}</p><p className="mt-1 font-serif text-2xl text-[#17353c]">{count}</p></div>)}</div></section> : null}
    {result ? <section className="mt-5 rounded-[24px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]">{result.errors.length ? <AlertTriangle className="h-5 w-5 text-[#b77928]" /> : <CheckCircle2 className="h-5 w-5 text-[#3a7d78]" />}<h2 className="mt-2 font-serif text-xl text-[#17353c]">Catalogue import {result.errors.length ? 'completed with errors' : 'completed'}</h2><p className="mt-1 text-sm text-[#617178]">{result.created} created · {result.updated} updated · {result.skipped} skipped. Job {result.job?.id || 'recorded'}.</p>{result.errors.length ? <ul className="mt-3 list-disc pl-5 text-sm text-[#815411]">{result.errors.slice(0, 10).map((error) => <li key={`${error.row}-${error.message}`}>{error.message}</li>)}</ul> : <p className="mt-3 text-sm text-[#42706a]">The branch setup checklist now records catalogue completion.</p>}</section> : null}
  </div>
}
