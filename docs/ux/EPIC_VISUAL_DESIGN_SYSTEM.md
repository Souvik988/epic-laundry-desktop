# Epic Laundry visual design system

Status: V4 continuation · implementation is partial and evidence-led

## Direction

Premium operational density: calm cream canvas, deep teal navigation and action surfaces, mint operational success, brass attention, restrained violet brand accent, and coral critical states. The interface should feel like a capable counter and control room, not a marketing dashboard.

## Tokens

| Role | Token | Use |
|---|---|---|
| Canvas | `#f3f1ec` | App background |
| Surface | `#fffdf8` | Primary cards and forms |
| Deep teal | `#123039` | Navigation and high-emphasis actions |
| Text primary | `#17353c` | Headings and key values |
| Text secondary | `#617178` | Supporting copy |
| Mint | `#eaf3ef` | Healthy/complete state |
| Brand violet | `#664cf0` | Brand emphasis and selected category state |
| Brass | `#e6bc65` | Attention and due-soon state |
| Critical coral | `#d86b4d` | Destructive or urgent state |
| Border | `rgba(38,63,68,.10)` | Quiet separation |

Color is never the only status signal: pair it with a label, icon and shape. Contrast and keyboard focus remain release gates.

## Type

Manrope is bundled for consistent offline rendering, with Noto Sans Devanagari for Indian-language names and copy. Use `font-display` for page titles and key numbers, `font-sans` for dense operational text, and `tabular-nums` for money, quantities, IDs and timestamps. Avoid decorative serif headings on dense work surfaces.

## Layout and density

- Page padding: compact on 1024px, expanding to 32px at desktop widths.
- Radius: 12px for controls, 20–24px for primary panels.
- Shadows: soft, low-opacity depth only; borders carry most structure.
- Primary KPI: 1–2 dominant values; secondary measures belong in compact groups.
- Tables are retained for precise evidence, audit and editing. Charts answer one question each.

## Visual primitives

Use the shared `VisualEmptyState` for genuine empty data. Loading, error, not-configured, permission-restricted and filter-empty states must remain distinct. Functional controls use Lucide/vector icons; generated raster assets are reserved for contextual empty states, category/service imagery and selected onboarding moments.

## Chart rules

Trend → line/area; comparison → bars; distribution → small donut; process → pipeline; ageing → horizontal bars; capacity → progress/bullet; schedule → timeline. Every important chart needs a text summary or accessible label, INR formatting from the canonical API values, bounded data, and a meaningful empty state. Recharts/SVG output is treated as the visual layer; use `ChartAccessibility` to pair it with a concise data-derived screen-reader summary and keep the visual tree `aria-hidden`.

## Motion and responsive rules

Use short, quiet fades and state transitions. Honour reduced motion. At 1024px, primary actions, order totals, filters and operational status must remain visible; only deliberately wide evidence grids may scroll.

## Loading surfaces

Data-backed routes use the shared `VisualLoadingState` rather than an unlabelled spinner on a blank canvas. The surface names the workspace being prepared, explains which local records are being read, exposes `aria-live="polite"`, and carries `data-testid="page-loading"` so runtime visual review waits for settled content. A loading surface is not an empty state and must not imply that a provider action has completed.
