// Dental reference data shared between the renderer (interactive chart) and reports.
import type { ToothConditionKey, SurfaceKey } from './types'

export type ToothType = 'molar' | 'premolar' | 'canine' | 'incisor'
export type Arch = 'upper' | 'lower'

export interface ToothMeta {
  number: number
  type: ToothType
  arch: Arch
  label: string
}

// Universal Numbering System (1-32). Tooth 1 = upper-right 3rd molar ... 16 = upper-left 3rd molar,
// 17 = lower-left 3rd molar ... 32 = lower-right 3rd molar.
const UPPER_TYPES: ToothType[] = [
  'molar', 'molar', 'molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor',
  'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar'
]

function typeForNumber(n: number): ToothType {
  if (n >= 1 && n <= 16) return UPPER_TYPES[n - 1]
  // Lower arch mirrors the upper arch shape from the midline outward.
  // 17..32 maps onto the same positional pattern.
  const lowerIndex = n - 17 // 0..15 (17 = back-left ... 32 = back-right)
  // Build lower pattern: positions 0..15 correspond to molar..molar mirrored like upper.
  const LOWER_TYPES: ToothType[] = [
    'molar', 'molar', 'molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor',
    'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar'
  ]
  return LOWER_TYPES[lowerIndex]
}

function labelForNumber(n: number): string {
  const t = typeForNumber(n)
  const side =
    (n >= 1 && n <= 8) || (n >= 25 && n <= 32) ? 'Right' : 'Left'
  const arch = n <= 16 ? 'Upper' : 'Lower'
  const names: Record<ToothType, string> = {
    molar: 'Molar',
    premolar: 'Premolar',
    canine: 'Canine',
    incisor: 'Incisor'
  }
  return `${arch} ${side} ${names[t]}`
}

export const TEETH: ToothMeta[] = Array.from({ length: 32 }, (_, i) => {
  const number = i + 1
  return {
    number,
    type: typeForNumber(number),
    arch: number <= 16 ? 'upper' : 'lower',
    label: labelForNumber(number)
  }
})

// Left-to-right display order so upper & lower teeth align vertically by position.
// Upper shows 1..16 left->right; lower shows 32..17 left->right (32 sits under 1).
export const UPPER_DISPLAY: number[] = Array.from({ length: 16 }, (_, i) => i + 1)
export const LOWER_DISPLAY: number[] = Array.from({ length: 16 }, (_, i) => 32 - i)

export interface ConditionMeta {
  key: ToothConditionKey
  label: string
  color: string
  description: string
}

export const CONDITIONS: ConditionMeta[] = [
  { key: 'unexamined', label: 'Unexamined', color: '#FFFFFF', description: 'No data recorded' },
  { key: 'healthy', label: 'Healthy', color: '#46B26A', description: 'Healthy / Normal' },
  { key: 'cavity', label: 'Cavity', color: '#F2C53D', description: 'Cavity / Decay detected' },
  { key: 'filled', label: 'Filled', color: '#3B82C4', description: 'Filled / Restored' },
  { key: 'missing', label: 'Missing', color: '#9AA7B2', description: 'Missing tooth' },
  { key: 'implant', label: 'Implant', color: '#E8893B', description: 'Implant' },
  { key: 'treatment', label: 'Needs Treatment', color: '#E0524A', description: 'Needs treatment / problem area' }
]

export const CONDITION_COLORS: Record<ToothConditionKey, string> = CONDITIONS.reduce(
  (acc, c) => {
    acc[c.key] = c.color
    return acc
  },
  {} as Record<ToothConditionKey, string>
)

export const CONDITION_LABELS: Record<ToothConditionKey, string> = CONDITIONS.reduce(
  (acc, c) => {
    acc[c.key] = c.label
    return acc
  },
  {} as Record<ToothConditionKey, string>
)

export const SURFACES: { key: SurfaceKey; label: string; hint: string }[] = [
  { key: 'occlusal', label: 'Occlusal', hint: 'Top / biting surface' },
  { key: 'buccal', label: 'Buccal', hint: 'Outer (cheek/lip) surface' },
  { key: 'lingual', label: 'Lingual', hint: 'Inner (tongue) surface' },
  { key: 'mesial', label: 'Mesial', hint: 'Front-facing side' },
  { key: 'distal', label: 'Distal', hint: 'Back-facing side' }
]

export function emptyToothState() {
  return { condition: 'unexamined' as ToothConditionKey, surfaces: [] as SurfaceKey[], note: '' }
}
