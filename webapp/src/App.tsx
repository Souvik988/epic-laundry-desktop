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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/laundry/dashboard" replace />} />
      <Route path="/laundry" element={<LaundryShell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<LaundryDashboard />} />
        <Route path="new-order" element={<LaundryBooking />} />
        <Route path="orders" element={<LaundryOrders />} />
        <Route path="catalogue" element={<LaundryCatalogue />} />
      </Route>
      <Route path="*" element={<LegacyErp />} />
    </Routes>
  );
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
