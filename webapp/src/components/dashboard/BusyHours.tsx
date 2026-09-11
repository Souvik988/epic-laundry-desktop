import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatINR } from "@/lib/utils"

interface Hour { hour: number; label: string; orders: number; revenue: number }

export function BusyHours({ data, loading }: { data?: Hour[]; loading?: boolean }) {
  // Show trading hours (8am–10pm) where retail activity happens.
  const hours = (data ?? []).filter((h) => h.hour >= 8 && h.hour <= 22)
  const max = Math.max(1, ...hours.map((h) => h.orders))

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Busy Hours</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hours} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={1} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))" }}
                formatter={((v: any, n: any) => (n === "orders" ? [`${v} orders`, "Orders"] : [formatINR(Number(v)), "Revenue"])) as any}
                contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
              />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                {hours.map((h) => (
                  <Cell key={h.hour} fill={h.orders >= max * 0.66 ? "#1A7A3C" : h.orders >= max * 0.33 ? "#66BB6A" : "#C8E6C9"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {!loading && <p className="sr-only">{hours.length ? `Busy hours by order count: ${hours.map((hour) => `${hour.label}: ${hour.orders} order${hour.orders === 1 ? '' : 's'}`).join('; ')}.` : 'No hourly order records are available.'}</p>}
      </CardContent>
    </Card>
  )
}
