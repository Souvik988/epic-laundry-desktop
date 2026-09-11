import { generatedVisualManifest } from '@/assets/generated/manifest'
import type { ReactNode } from 'react'

type VisualEmptyStateProps = {
  kind?: 'operations' | 'finance' | 'delivery' | 'quality' | 'customers' | 'orders'
  title: string
  detail: string
  compact?: boolean
  action?: ReactNode
}

/**
 * A calm state for genuinely empty local data. It deliberately does not imply
 * a failure, completed provider action, or missing business activity.
 */
export default function VisualEmptyState({ kind = 'operations', title, detail, compact = false, action }: VisualEmptyStateProps) {
  const source = kind === 'finance' ? generatedVisualManifest.illustrations.emptyFinance : kind === 'delivery' ? generatedVisualManifest.illustrations.emptyDelivery : kind === 'quality' ? generatedVisualManifest.illustrations.emptyQuality : kind === 'customers' ? generatedVisualManifest.illustrations.emptyCustomers : kind === 'orders' ? generatedVisualManifest.illustrations.emptyOrder : generatedVisualManifest.illustrations.emptyOperations
  return <div className={`grid place-items-center text-center ${compact ? 'py-5' : 'py-10'}`}>
    <img src={source} alt="" className={compact ? 'h-20 w-20 object-contain' : 'h-32 w-32 object-contain'} />
    <p className="mt-2 text-sm font-bold text-[#315d57]">{title}</p>
    <p className="mt-1 max-w-xs text-xs leading-5 text-[#718087]">{detail}</p>
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
}
