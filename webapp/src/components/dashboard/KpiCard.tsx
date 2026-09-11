import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatTrend } from "@/lib/utils"
import { Area, AreaChart, ResponsiveContainer } from "recharts"

export function KpiCard({
  label, value, sub, change, icon, variant = "default", spark,
}: {
  label: string
  value?: string
  sub?: string
  change?: number
  icon: React.ReactNode
  variant?: "primary" | "default"
  spark?: number[]
}) {
  const isPrimary = variant === "primary"
  const trend = change !== undefined ? formatTrend(change) : null
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }))

  return (
    <Card
      className={cn(
        "relative overflow-hidden p-5 transition-all duration-200 hover:shadow-md",
        isPrimary ? "border-0 text-white shadow-lg" : "bg-card"
      )}
      style={isPrimary ? { background: "linear-gradient(135deg,#664CF0 0%,#5138CF 58%,#35216F 100%)" } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium uppercase tracking-wider", isPrimary ? "text-white/80" : "text-muted-foreground")}>
          {label}
        </span>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", isPrimary ? "bg-white/15" : "bg-brand-50 text-brand-600")}>
          {icon}
        </div>
      </div>

      <div className="mt-3">
        {value === undefined ? (
          <Skeleton className={cn("h-8 w-28", isPrimary && "bg-white/20")} />
        ) : (
          <div className="text-2xl font-bold tabular-nums">{value}</div>
        )}
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn("text-xs font-semibold", isPrimary ? "text-white" : trend.isPositive ? "text-success" : "text-danger")}>
              {trend.text}
            </span>
          )}
          {sub && <span className={cn("text-xs", isPrimary ? "text-white/70" : "text-muted-foreground")}>{sub}</span>}
        </div>
      </div>

      {isPrimary && sparkData.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-12 opacity-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="kpiSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="#fff" strokeWidth={1.5} fill="url(#kpiSpark)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
