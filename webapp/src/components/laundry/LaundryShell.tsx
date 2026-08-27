import { NavLink, Outlet } from 'react-router-dom'
import { Bell, BookOpenCheck, ClipboardList, LayoutDashboard, Plus, Shirt, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { to: '/laundry/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/laundry/new-order', label: 'Order booking', icon: Plus },
  { to: '/laundry/orders', label: 'Store orders', icon: ClipboardList },
  { to: '/laundry/catalogue', label: 'Garments & prices', icon: Shirt },
]

export function LaundryShell() {
  return (
    <div className="min-h-screen bg-[#f3f1ec] text-[#18242b] selection:bg-[#a9d8d4] selection:text-[#10242a]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[#213d45]/15 bg-[#123039] px-4 py-5 text-[#eaf0e9] lg:flex">
        <NavLink to="/laundry/dashboard" className="mb-10 flex items-center gap-3 px-2">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#e6bc65] font-serif text-xl font-bold text-[#17363e] shadow-[0_8px_20px_rgba(0,0,0,.18)]">E</span>
          <span>
            <span className="block font-serif text-[19px] leading-none tracking-tight">Epic Laundry</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[.18em] text-[#a8c4bc]">Counter desk</span>
          </span>
        </NavLink>
        <nav className="space-y-1">
          {navigation.map((item) => (
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
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#123039] font-serif text-lg text-[#e6bc65]">E</span>
            <span className="font-serif text-lg">Epic Laundry</span>
          </div>
          <div className="hidden items-center gap-2 text-sm text-[#617178] lg:flex">
            <BookOpenCheck className="h-4 w-4 text-[#3a7d78]" />
            <span>Local desktop workspace</span>
          </div>
          <div className="flex items-center gap-2">
            <NavLink to="/laundry/new-order" className="inline-flex items-center gap-2 rounded-xl bg-[#123039] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4a53]">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New order</span>
            </NavLink>
            <button className="grid h-9 w-9 place-items-center rounded-xl text-[#476066] transition hover:bg-[#e6e5df]" aria-label="Notifications">
              <Bell className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 md:p-7"><Outlet /></main>
      </div>
    </div>
  )
}
