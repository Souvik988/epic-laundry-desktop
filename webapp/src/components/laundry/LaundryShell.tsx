import { NavLink, Outlet } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart3, Bell, Bike, BookOpenCheck, ChevronDown, ClipboardList, ContactRound, LayoutDashboard, LogOut, MapPinned, Plus, Printer, ReceiptText, Settings2, Shirt, Sparkles, Upload, UsersRound, WalletCards, CircleDollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiGet, apiPost } from '@/lib/api'
import { useState } from 'react'
import { lndryBrand } from '@/assets/generated/manifest'

const navigation: Array<{ to: string; label: string; icon: typeof LayoutDashboard; permission: UiPermission }> = [
  { to: '/laundry/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'orders.read' },
  { to: '/laundry/statistics', label: 'Overview', icon: BarChart3, permission: 'orders.read' },
  { to: '/laundry/customers', label: 'Customers', icon: ContactRound, permission: 'customers.read' },
  { to: '/laundry/packages', label: 'Care packages', icon: Sparkles, permission: 'packages.read' },
  { to: '/laundry/new-order', label: 'Order booking', icon: Plus, permission: 'orders.create' },
  { to: '/laundry/orders', label: 'Store orders', icon: ClipboardList, permission: 'orders.read' },
  { to: '/laundry/print-centre', label: 'Print centre', icon: Printer, permission: 'orders.read' },
  { to: '/laundry/settlements', label: 'Rider settlements', icon: CircleDollarSign, permission: 'orders.read' },
  { to: '/laundry/dispatch', label: 'Pickup & delivery', icon: Bike, permission: 'orders.read' },
  { to: '/laundry/expenses', label: 'Store expense', icon: WalletCards, permission: 'expenses.create' },
  { to: '/laundry/import-prices', label: 'Import prices', icon: Upload, permission: 'settings.manage' },
  { to: '/laundry/import-customers', label: 'Import customers', icon: UsersRound, permission: 'settings.manage' },
  { to: '/laundry/reports', label: 'Reports', icon: ReceiptText, permission: 'settings.manage' },
  { to: '/laundry/catalogue', label: 'Garments & prices', icon: Shirt, permission: 'catalogue.read' },
  { to: '/laundry/settings', label: 'Store settings', icon: Settings2, permission: 'settings.manage' },
]

export type UiPermission = 'orders.read' | 'orders.create' | 'expenses.create' | 'settings.manage' | 'catalogue.read' | 'customers.read' | 'packages.read'
export function canUseUi(roles: string[] | undefined, permission: UiPermission) {
  if (roles?.includes('owner')) return true
  const rolePermissions: Record<string, UiPermission[]> = {
    counter_staff: ['orders.read', 'orders.create', 'expenses.create', 'customers.read', 'packages.read'],
    processing_staff: ['orders.read', 'catalogue.read', 'packages.read'],
    rider: [],
  }
  return roles?.some((role) => rolePermissions[role]?.includes(permission)) || false
}

export function LaundryShell() {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<Session>('/auth/session') })
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => apiGet<NotificationItem[]>('/notifications') })
  const markRead = useMutation({ mutationFn: (id: string) => apiPost(`/notifications/${id}/read`, { read: true }), onSuccess: () => notifications.refetch() })
  const signOut = useMutation({ mutationFn: () => apiPost('/auth/sign-out'), onSuccess: () => window.location.assign('/ui/app/') })
  const permittedNavigation = navigation.filter((item) => canUseUi(session.data?.user?.roles, item.permission))
  const canBook = canUseUi(session.data?.user?.roles, 'orders.create')
  return (
    <div className="min-h-screen bg-[#f3f1ec] text-[#18242b] selection:bg-[#a9d8d4] selection:text-[#10242a]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[#213d45]/15 bg-[#123039] px-4 py-5 text-[#eaf0e9] lg:flex">
        <NavLink to="/laundry/dashboard" className="mb-10 flex items-center gap-3 px-2">
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-[14px] bg-white shadow-[0_8px_20px_rgba(0,0,0,.18)]"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-cover" /></span>
          <span>
            <span className="block font-serif text-[19px] leading-none tracking-tight">Epic Laundry</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[.18em] text-[#a8c4bc]">Counter desk</span>
          </span>
        </NavLink>
        <nav className="space-y-1">
          {permittedNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all',
                isActive ? 'bg-[#e8bf68] text-[#17363e] shadow-[0_7px_16px_rgba(0,0,0,.16)]' : 'text-[#bfd0c9] hover:bg-[#1b454e] hover:text-white',
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-[#87aaa0]/20 bg-[#0e272e] p-4">
          <Sparkles className="mb-2 h-4 w-4 text-[#e6bc65]" />
          <p className="font-serif text-sm">Built for the counter.</p>
          <p className="mt-1 text-xs leading-5 text-[#a8c4bc]">Orders and catalogue stay on this desktop when you are offline.</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#263f44]/10 bg-[#f8f7f3]/90 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white shadow-sm"><img src={lndryBrand.mark} alt="Lndry" className="h-full w-full object-cover" /></span>
            <span className="font-serif text-lg">Epic Laundry</span>
          </div>
          <StoreSwitcher />
          <div className="flex items-center gap-2">
            {canBook ? <NavLink to="/laundry/new-order" className="inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4a53]">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New order</span>
            </NavLink> : null}
            <div className="relative"><button type="button" onClick={() => setNotificationsOpen((value) => !value)} className="relative grid h-9 w-9 place-items-center rounded-xl text-[#476066] transition hover:bg-[#e6e5df]" aria-label="Notifications"><Bell className="h-[18px] w-[18px]" />{(notifications.data || []).filter((item) => !item.read).length ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#d86b4d] ring-2 ring-[#f8f7f3]" /> : null}</button>{notificationsOpen && <NotificationPopover rows={notifications.data || []} pending={markRead.isPending} onRead={(id) => markRead.mutate(id)} onClose={() => setNotificationsOpen(false)} />}</div>
            <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()} className="grid h-9 w-9 place-items-center rounded-xl text-[#476066] transition hover:bg-[#e6e5df] disabled:opacity-50" aria-label="Sign out" title="Sign out"><LogOut className="h-[18px] w-[18px]" /></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 md:p-7"><Outlet /></main>
      </div>
    </div>
  )
}

type Session = { user: { username: string; roles: string[]; storeId: string } | null }
type Branch = { id: string; name: string; code: string; enabled: boolean; roles: string[] }
type NotificationItem = { id: string; title: string; body?: string; kind?: string; severity?: string; read?: boolean; created_at: string }

function NotificationPopover({ rows, pending, onRead, onClose }: { rows: NotificationItem[]; pending: boolean; onRead: (id: string) => void; onClose: () => void }) {
  return <div className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[#263f44]/10 bg-[#fffdf8] shadow-2xl"><div className="flex items-center justify-between border-b border-[#263f44]/10 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#4d8982]">Inbox</p><p className="font-serif text-lg text-[#17353c]">Notifications</p></div><button type="button" onClick={onClose} className="text-xs font-semibold text-[#718087]">Close</button></div><div className="max-h-80 overflow-y-auto">{rows.length ? rows.slice(0, 20).map((item) => <div key={item.id} className={`border-b border-[#263f44]/8 px-4 py-3 ${item.read ? 'bg-white' : 'bg-[#f4f8f5]'}`}><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[#24464a]">{item.title}</p><p className="mt-1 text-xs leading-5 text-[#718087]">{item.body}</p><p className="mt-1 text-[10px] uppercase tracking-[.1em] text-[#91a09f]">{item.kind || 'System'} · {new Date(item.created_at).toLocaleString('en-IN')}</p></div>{!item.read && <button type="button" disabled={pending} onClick={() => onRead(item.id)} className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-[#39786f] ring-1 ring-inset ring-[#39786f]/20">Mark read</button>}</div></div>) : <p className="p-8 text-center text-sm text-[#718087]">No notifications yet.</p>}</div></div>
}

function StoreSwitcher() {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<Session>('/auth/session') })
  const isOwner = Boolean(session.data?.user?.roles.includes('owner'))
  const branches = useQuery({ queryKey: ['branch-memberships'], queryFn: () => apiGet<Branch[]>('/settings/stores'), enabled: isOwner })
  const active = branches.data?.find((branch) => branch.id === session.data?.user?.storeId)
  const switchStore = useMutation({ mutationFn: (storeId: string) => apiPost('/auth/switch-store', { storeId }), onSuccess: () => window.location.assign('/ui/app/#/laundry/dashboard') })
  if (!isOwner || !branches.data?.length) return <div className="hidden items-center gap-2 text-sm text-[#617178] lg:flex"><BookOpenCheck className="h-4 w-4 text-[#3a7d78]" /><span>Local desktop workspace</span></div>
  return <label className="hidden items-center gap-2 text-sm text-[#617178] lg:flex"><MapPinned className="h-4 w-4 text-[#3a7d78]" /><span className="sr-only">Active branch</span><div className="relative"><select aria-label="Active branch" value={session.data?.user?.storeId || ''} disabled={switchStore.isPending} onChange={(event) => switchStore.mutate(event.target.value)} className="appearance-none rounded-lg bg-transparent py-1 pr-6 font-semibold text-[#31484d] outline-none hover:bg-[#eeece6] disabled:opacity-60">{branches.data.filter((branch) => branch.enabled).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-0 top-1.5 h-4 w-4" /></div><span className="text-xs text-[#819095]">{active ? 'Local branch' : 'Switching…'}</span></label>
}
