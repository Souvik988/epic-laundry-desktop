import { useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { formatINR, formatShort } from "@/lib/utils"

interface Point { date: string; label: string; revenue: number; orders: number }

export function RevenueTrend({ data, loading }: { data?: Point[]; loading?: boolean }) {
  const [range, setRange] = useState("14")
  const series = (data ?? []).slice(-Number(range))
  const total = series.reduce((a, d) => a + d.revenue, 0)

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-semibold">Revenue Trend</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">{formatINR(total)} total</p>
        </div>
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="h-8">
            <TabsTrigger value="7" className="h-7 px-3 text-xs">7D</TabsTrigger>
            <TabsTrigger value="14" className="h-7 px-3 text-xs">14D</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1A7A3C" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1A7A3C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => formatShort(v)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56} />
              <Tooltip
                formatter={(v: any) => [formatINR(Number(v)), "Revenue"]}
                contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#1A7A3C" strokeWidth={2.5} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!loading && <p className="sr-only">{series.length ? `${series.length}-day revenue trend totaling ${formatINR(total)}. ${series.map((point) => `${point.label}: ${formatINR(point.revenue)} and ${point.orders} order${point.orders === 1 ? '' : 's'}`).join('; ')}.` : 'No revenue records are available for this period.'}</p>}
      </CardContent>
    </Card>
  )
}
