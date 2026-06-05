// Tooth-chart geometry + static SVG renderer. Lives in shared/ so the interactive
// React chart AND the main-process report generator use identical geometry.
import { UPPER_DISPLAY, LOWER_DISPLAY, TEETH, CONDITION_COLORS, type ToothType } from './dental'
import { COLORS } from './branding'
import type { ToothChartData } from './types'

export const VIEW = { w: 900, h: 540 }

const UPPER = { cx: 450, cy: 300, rx: 375, ry: 232, a0: 198, a1: 342 }
const LOWER = { cx: 450, cy: 232, rx: 375, ry: 232, a0: 162, a1: 18 }

export interface ToothLayout {
  number: number
  type: ToothType
  x: number
  y: number
  rot: number
  labelX: number
  labelY: number
}

const typeByNumber = new Map(TEETH.map((t) => [t.number, t.type]))

function place(arch: typeof UPPER, numbers: number[]): ToothLayout[] {
  const n = numbers.length
  return numbers.map((number, i) => {
    const a = (arch.a0 + ((arch.a1 - arch.a0) * i) / (n - 1)) * (Math.PI / 180)
    const x = arch.cx + arch.rx * Math.cos(a)
    const y = arch.cy + arch.ry * Math.sin(a)
    const rot = (Math.atan2(arch.cy - y, arch.cx - x) * 180) / Math.PI - 90
    const dx = x - arch.cx
    const dy = y - arch.cy
    const len = Math.hypot(dx, dy) || 1
    const off = 36
    return {
      number,
      type: typeByNumber.get(number) || 'molar',
      x,
      y,
      rot,
      labelX: x + (dx / len) * off,
      labelY: y + (dy / len) * off
    }
  })
}

export function computeLayout(): ToothLayout[] {
  return [...place(UPPER, UPPER_DISPLAY), ...place(LOWER, LOWER_DISPLAY)]
}

export function archGuides(): { upper: string; lower: string } {
  const pt = (arch: typeof UPPER, deg: number) => ({
    x: arch.cx + arch.rx * Math.cos((deg * Math.PI) / 180),
    y: arch.cy + arch.ry * Math.sin((deg * Math.PI) / 180)
  })
  const ul = pt(UPPER, UPPER.a0)
  const ur = pt(UPPER, UPPER.a1)
  const ll = pt(LOWER, LOWER.a0)
  const lr = pt(LOWER, LOWER.a1)
  return {
    upper: `M ${ul.x.toFixed(1)} ${ul.y.toFixed(1)} A ${UPPER.rx} ${UPPER.ry} 0 0 1 ${ur.x.toFixed(1)} ${ur.y.toFixed(1)}`,
    lower: `M ${ll.x.toFixed(1)} ${ll.y.toFixed(1)} A ${LOWER.rx} ${LOWER.ry} 0 0 0 ${lr.x.toFixed(1)} ${lr.y.toFixed(1)}`
  }
}

// Crown-forward anatomical shapes (crown points toward +y / arch centre).
export const SHAPE_PATHS: Record<ToothType, string> = {
  incisor: 'M-9 20 Q-11 4 -8 -10 Q-5 -22 0 -22 Q5 -22 8 -10 Q11 4 9 20 Q0 26 -9 20 Z',
  canine: 'M0 25 Q-10 14 -9 -2 Q-7 -20 0 -23 Q7 -20 9 -2 Q10 14 0 25 Z',
  premolar:
    'M-12 13 Q-7 21 -3 15 Q0 12 3 15 Q7 21 12 13 Q15 -3 9 -15 Q0 -23 -9 -15 Q-15 -3 -12 13 Z',
  molar:
    'M-16 13 Q-11 21 -7 15 Q-3.5 12 0 15 Q3.5 12 7 15 Q11 21 16 13 Q19 -5 12 -17 Q0 -25 -12 -17 Q-19 -5 -16 13 Z'
}

export function decorFor(type: ToothType): string[] {
  if (type === 'molar') return ['M-7 9 Q0 4 7 9', 'M0 6 V14']
  if (type === 'premolar') return ['M0 7 V14']
  return []
}

export function colorFor(data: ToothChartData, number: number): string {
  const st = data[number]
  return CONDITION_COLORS[st?.condition ?? 'unexamined']
}

export function toothChartSvgString(
  data: ToothChartData,
  labels?: { upper?: string; lower?: string }
): string {
  const upperLabel = labels?.upper ?? 'UPPER'
  const lowerLabel = labels?.lower ?? 'LOWER'
  const layout = computeLayout()
  const guides = archGuides()
  const teeth = layout
    .map((t) => {
      const fill = colorFor(data, t.number)
      const decor = decorFor(t.type)
        .map(
          (d) =>
            `<path d="${d}" fill="none" stroke="${COLORS.navy}" stroke-width="1" opacity="0.3"/>`
        )
        .join('')
      return `<g transform="translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) rotate(${t.rot.toFixed(1)})">
        <path d="${SHAPE_PATHS[t.type]}" fill="${fill}" stroke="${COLORS.navy}" stroke-width="1.4"/>
        ${decor}
      </g>
      <text x="${t.labelX.toFixed(1)}" y="${t.labelY.toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="700" fill="${COLORS.navy}" text-anchor="middle" dominant-baseline="middle">${t.number}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" width="${VIEW.w}" height="${VIEW.h}">
    <text x="450" y="20" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" fill="${COLORS.muted}" text-anchor="middle">${upperLabel}</text>
    <text x="450" y="${VIEW.h - 8}" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" fill="${COLORS.muted}" text-anchor="middle">${lowerLabel}</text>
    <path d="${guides.upper}" fill="none" stroke="${COLORS.azureSoft}" stroke-width="26" stroke-linecap="round"/>
    <path d="${guides.lower}" fill="none" stroke="${COLORS.azureSoft}" stroke-width="26" stroke-linecap="round"/>
    ${teeth}
  </svg>`
}
