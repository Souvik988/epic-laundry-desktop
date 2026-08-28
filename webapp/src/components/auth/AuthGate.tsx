import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { lndryBrand } from '@/assets/generated/manifest'

type Session = { user: { username: string; roles: string[]; tenant: string; storeId: string } | null }

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'bootstrap' | 'signin' | 'ready'>('loading')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onExpired = () => {
      setPassword('')
      setConfirmPassword('')
      setError('Your session expired. Sign in again.')
      setState('signin')
    }
    window.addEventListener('epic-auth-expired', onExpired)
    return () => window.removeEventListener('epic-auth-expired', onExpired)
  }, [])

  useEffect(() => {
    Promise.all([apiGet<Session>('/auth/session').catch(() => null), apiGet<{ needsBootstrap: boolean }>('/auth/bootstrap-status')])
      .then(([session, bootstrap]) => setState(session?.user ? 'ready' : bootstrap.needsBootstrap ? 'bootstrap' : 'signin'))
      .catch(() => { setError('The local Epic server is unavailable. Check that the desktop application is running.'); setState('signin') })
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (state === 'bootstrap' && password !== confirmPassword) { setError('Passwords do not match.'); return }
    setSaving(true)
    try {
      await apiPost(state === 'bootstrap' ? '/auth/bootstrap' : '/auth/sign-in', { username, password })
      setState('ready')
      setPassword('')
      setConfirmPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.')
    } finally { setSaving(false) }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'loading') return <main className="grid min-h-screen place-items-center bg-[#f3f1ec] text-[#17363e]"><p className="rounded-xl border border-[#17363e]/10 bg-white px-5 py-3 text-sm shadow-sm">Opening your secure local workspace…</p></main>

  const bootstrap = state === 'bootstrap'
  return <main className="grid min-h-screen place-items-center bg-[#f3f1ec] p-5 text-[#17363e]">
    <section className="w-full max-w-md rounded-3xl border border-[#17363e]/10 bg-white p-7 shadow-[0_24px_70px_rgba(18,48,57,.14)]">
      <div className="mb-7 flex items-start gap-4"><span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-cover" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#3a7d78]">Epic Laundry desktop</p><h1 className="mt-1 font-serif text-2xl">{bootstrap ? 'Create the owner account' : 'Welcome back'}</h1></div></div>
      <p className="mb-6 text-sm leading-6 text-[#617178]">{bootstrap ? 'This is a local-only first-run step. Choose credentials for the person who manages this store.' : 'Sign in to open your authorised counter workspace.'}</p>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block text-sm font-semibold">Username<input autoComplete="username" required minLength={3} value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 outline-none ring-[#3a7d78] focus:ring-2" /></label>
        <label className="block text-sm font-semibold">Password<input autoComplete={bootstrap ? 'new-password' : 'current-password'} required minLength={12} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 outline-none ring-[#3a7d78] focus:ring-2" />{bootstrap ? <span className="mt-1 block text-xs font-normal text-[#718087]">Use at least 12 characters for the local owner account.</span> : null}</label>
        {bootstrap ? <label className="block text-sm font-semibold">Confirm password<input autoComplete="new-password" required minLength={12} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#17363e]/15 px-3 py-2.5 outline-none ring-[#3a7d78] focus:ring-2" /></label> : null}
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#123039] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4a53] disabled:cursor-not-allowed disabled:opacity-60"><KeyRound className="h-4 w-4" />{saving ? 'Please wait…' : bootstrap ? 'Create owner account' : 'Sign in'}</button>
      </form>
    </section>
  </main>
}
