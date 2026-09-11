import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatINR } from "@/lib/utils"

interface Slice { mode: string; count: number; value: number }
const COLORS: Record<string, string> = {
  Cash: "#1A7A3C", UPI: "#3B82F6", Card: "#8B5CF6", Credit: "#F59E0B", Bank: "#10B981",
}

export function PaymentMix({ data, loading }: { data?: Slice[]; loading?: boolean }) {
  const slices = data ?? []
  const total = slices.reduce((a, s) => a + s.value, 0)

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Payment Mix</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : slices.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No sales yet</div>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={180}>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="mode" innerRadius={48} outerRadius={72} paddingAngle={2}>
                  {slices.map((s) => (
                    <Cell key={s.mode} fill={COLORS[s.mode] ?? "#94A3B8"} />
                  ))}
                </Pie>
                <Tooltip formatter={((v: any) => formatINR(Number(v))) as any} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {slices.map((s) => (
                <div key={s.mode} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[s.mode] ?? "#94A3B8" }} />
                    {s.mode}
                  </span>
                  <span className="font-medium tabular-nums">{total ? Math.round((s.value / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && <p className="sr-only">{slices.length ? `Payment mix: ${slices.map((slice) => `${slice.mode} ${formatINR(slice.value)} across ${slice.count} payment${slice.count === 1 ? '' : 's'}`).join('; ')}.` : 'No payment records are available.'}</p>}
      </CardContent>
    </Card>
  )
}
