import type { ReactNode } from 'react'

/**
 * Recharts is intentionally kept as a visual layer. This wrapper gives each
 * chart a concise, data-derived text alternative without asking a screen
 * reader to interpret an SVG tree or tooltip interaction.
 */
export default function ChartAccessibility({
  label,
  summary,
  className = '',
  children,
}: {
  label: string
  summary: string
  className?: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className={className}>
      <div aria-hidden="true" className="h-full">
        {children}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  )
}
