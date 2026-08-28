import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"

dayjs.extend(relativeTime)

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format number as Indian Rupee: ₹1,24,500 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Short Indian format: ₹1.24L, ₹1.24Cr */
export function formatShort(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n}`
}

/** Format number with Indian system: 1,24,500 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n)
}

/** Short number: 12.5K, 1.24L */
export function formatNumberShort(n: number): string {
  if (n >= 10000000) return `${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `${(n / 100000).toFixed(2)}L`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString("en-IN")
}

/** DD/MM/YYYY format */
export function formatDate(date: string | Date): string {
  return dayjs(date).format("DD/MM/YYYY")
}

/** DD/MM/YYYY, h:mm A IST */
export function formatDateTime(date: string | Date): string {
  return dayjs(date).format("DD/MM/YYYY, h:mm A")
}

/** HTML date-input key in the operator's local calendar (never UTC-shifted). */
export function localDateKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Relative time: "2 min ago", "3 hours ago" */
export function formatRelativeTime(date: string | Date): string {
  return dayjs(date).fromNow()
}

/** Trend arrow + percentage text */
export function formatTrend(change: number): { text: string; isPositive: boolean } {
  const isPositive = change >= 0
  return {
    text: `${isPositive ? "↑" : "↓"} ${Math.abs(change).toFixed(1)}%`,
    isPositive,
  }
}
