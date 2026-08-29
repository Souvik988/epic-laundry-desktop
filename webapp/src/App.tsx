import { type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Rail } from "@/components/layout/Rail";
import { SubSidebar } from "@/components/layout/SubSidebar";
import { Header } from "@/components/layout/Header";
import { CommandPalette } from "@/components/layout/CommandPalette";
import Dashboard from "@/pages/Dashboard";
import { Placeholder } from "@/pages/Placeholder";
import { ALL_PAGES } from "@/lib/nav";
import { LaundryShell } from "@/components/laundry/LaundryShell";
import LaundryDashboard from "@/pages/laundry/LaundryDashboard";
import LaundryBooking from "@/pages/laundry/LaundryBooking";
import LaundryOrders from "@/pages/laundry/LaundryOrders";
import LaundryCatalogue from "@/pages/laundry/LaundryCatalogue";
import LaundryExpenses from "@/pages/laundry/LaundryExpenses";
import LaundryReports from "@/pages/laundry/LaundryReports";
import LaundryImport from "@/pages/laundry/LaundryImport";
import LaundryCatalogueImport from "@/pages/laundry/LaundryCatalogueImport";
import LaundryDispatch from "@/pages/laundry/LaundryDispatch";
import LaundrySettings from "@/pages/laundry/LaundrySettings";
import LaundryCustomers from "@/pages/laundry/LaundryCustomers";
import LaundryPackages from "@/pages/laundry/LaundryPackages";
import LaundryPrintCentre from "@/pages/laundry/LaundryPrintCentre";
import LaundrySettlements from "@/pages/laundry/LaundrySettlements";
import LaundryReportDetail from "@/pages/laundry/LaundryReportDetail";
import LaundryStatistics from "@/pages/laundry/LaundryStatistics";
import LaundryGarmentTracking from "@/pages/laundry/LaundryGarmentTracking";
import LaundryCashClosing from "@/pages/laundry/LaundryCashClosing";
import LaundryProductionQueue from "@/pages/laundry/LaundryProductionQueue";
import LaundryQualityClaims from "@/pages/laundry/LaundryQualityClaims";
import LaundryCorrections from "@/pages/laundry/LaundryCorrections";
import LaundryRoutes from "@/pages/laundry/LaundryRoutes";
import { AuthGate } from "@/components/auth/AuthGate";
import { canUseUi, type UiPermission } from "@/components/laundry/LaundryShell";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function App() {
  return (
    <AuthGate>
    <Routes>
      <Route path="/" element={<Navigate to="/laundry/dashboard" replace />} />
      <Route path="/laundry" element={<LaundryShell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<PermissionGate permission="orders.read"><LaundryDashboard /></PermissionGate>} />
        <Route path="customers" element={<PermissionGate permission="customers.read"><LaundryCustomers /></PermissionGate>} />
        <Route path="customers/:id" element={<PermissionGate permission="customers.read"><LaundryCustomers /></PermissionGate>} />
        <Route path="packages" element={<PermissionGate permission="packages.read"><LaundryPackages /></PermissionGate>} />
        <Route path="new-order" element={<PermissionGate permission="orders.create"><LaundryBooking /></PermissionGate>} />
        <Route path="orders" element={<PermissionGate permission="orders.read"><LaundryOrders /></PermissionGate>} />
        <Route path="garment-tracking" element={<PermissionGate permission="garments.read"><LaundryGarmentTracking /></PermissionGate>} />
        <Route path="cash-closing" element={<PermissionGate permission="cash.read"><LaundryCashClosing /></PermissionGate>} />
        <Route path="production-queue" element={<PermissionGate permission="production.read"><LaundryProductionQueue /></PermissionGate>} />
        <Route path="quality-claims" element={<PermissionGate permission="quality.read"><LaundryQualityClaims /></PermissionGate>} />
        <Route path="corrections" element={<PermissionGate permission="quality.read"><LaundryCorrections /></PermissionGate>} />
        <Route path="routes" element={<PermissionGate permission="routes.read"><LaundryRoutes /></PermissionGate>} />
        <Route path="print-centre" element={<PermissionGate permission="orders.read"><LaundryPrintCentre /></PermissionGate>} />
        <Route path="settlements" element={<PermissionGate permission="orders.read"><LaundrySettlements /></PermissionGate>} />
        <Route path="dispatch" element={<PermissionGate permission="orders.read"><LaundryDispatch /></PermissionGate>} />
        <Route path="expenses" element={<PermissionGate permission="expenses.create"><LaundryExpenses /></PermissionGate>} />
        <Route path="reports" element={<PermissionGate permission="settings.manage"><LaundryReports /></PermissionGate>} />
        <Route path="reports/:kind" element={<PermissionGate permission="settings.manage"><LaundryReportDetail /></PermissionGate>} />
        <Route path="statistics" element={<PermissionGate permission="orders.read"><LaundryStatistics /></PermissionGate>} />
        <Route path="import-prices" element={<PermissionGate permission="settings.manage"><LaundryImport mode="prices" /></PermissionGate>} />
        <Route path="import-customers" element={<PermissionGate permission="settings.manage"><LaundryImport mode="customers" /></PermissionGate>} />
        <Route path="import-catalogue" element={<PermissionGate permission="settings.manage"><LaundryCatalogueImport /></PermissionGate>} />
        <Route path="catalogue" element={<PermissionGate permission="catalogue.read"><LaundryCatalogue /></PermissionGate>} />
        <Route path="settings" element={<PermissionGate permission="settings.manage"><LaundrySettings /></PermissionGate>} />
      </Route>
      <Route path="*" element={<LegacyErp />} />
    </Routes>
    </AuthGate>
  );
}

function PermissionGate({ permission, children }: { permission: UiPermission; children: ReactNode }) {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  if (session.isLoading) return <div className="grid h-72 place-items-center text-sm text-muted-foreground">Checking your workspace access…</div>
  if (!canUseUi(session.data?.user?.roles, permission)) return <section className="mx-auto mt-16 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-7 text-center text-amber-950"><h1 className="font-serif text-2xl">This workspace is not assigned to your role.</h1><p className="mt-2 text-sm leading-6">Ask an owner to update your branch access if you need this part of Epic Laundry.</p></section>
  return <>{children}</>
}

/** The original generic ERP remains available on its existing routes while Laundry is the default desk. */
function LegacyErp() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Rail pathname={pathname} />
      <SubSidebar pathname={pathname} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenCommand={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))} />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            {ALL_PAGES.filter((p) => p.to !== "/dashboard").map((p) => (
              <Route key={p.to} path={p.to} element={<Placeholder title={p.label} />} />
            ))}
            <Route path="*" element={<Placeholder title="Coming soon" />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
