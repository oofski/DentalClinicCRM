// Giving Smiles brand assets shared by the React UI and the printable PDF documents.
// The logo is recreated in SVG (azure heart + dental-floss strand + navy wordmark)
// to match the uploaded logo's colours and feel.

export const COLORS = {
  navy: '#16335B',
  navyDark: '#0F2542',
  azure: '#2FA8DF',
  azureLight: '#6FC5EC',
  azureSoft: '#E8F4FB',
  bg: '#F4F8FB',
  surface: '#FFFFFF',
  text: '#1B2B40',
  muted: '#5A6B7B',
  border: '#D8E3EC',
  danger: '#E0524A',
  warning: '#F2C53D',
  success: '#46B26A'
}

const FONT_STACK = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

/** The heart + dental-floss mark on its own (used for the app icon and compact spots). */
export function logoMarkSvg(size = 120, background?: string): string {
  const bg = background
    ? `<rect width="120" height="120" rx="26" fill="${background}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Giving Smiles">
    ${bg}
    <path d="M60 103 C 17 74 9 45 30 27 C 44 15 60 23 60 39 C 60 23 76 15 90 27 C 111 45 103 74 60 103 Z" fill="${COLORS.azure}"/>
    <path d="M24 41 C 44 25 76 25 96 41" fill="none" stroke="${COLORS.navy}" stroke-width="5.5" stroke-linecap="round"/>
    <circle cx="24" cy="41" r="4.6" fill="${COLORS.navy}"/>
    <circle cx="96" cy="41" r="4.6" fill="${COLORS.navy}"/>
    <path d="M30 64 C 52 86 84 84 104 58" fill="none" stroke="${COLORS.navyDark}" stroke-width="4" stroke-linecap="round" opacity="0.92"/>
  </svg>`
}

/** Full horizontal lockup: mark + stacked "Giving / Smiles" wordmark. */
export function logoLockupSvg(opts?: { height?: number; mono?: boolean }): string {
  const h = opts?.height ?? 56
  const w = h * 4.0
  const textColor = opts?.mono ? COLORS.navy : COLORS.navy
  // viewBox 0 0 400 100 ; mark on left, wordmark on right
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="${w}" height="${h}" role="img" aria-label="Giving Smiles">
    <g transform="translate(2,4) scale(0.78)">
      <path d="M60 103 C 17 74 9 45 30 27 C 44 15 60 23 60 39 C 60 23 76 15 90 27 C 111 45 103 74 60 103 Z" fill="${COLORS.azure}"/>
      <path d="M24 41 C 44 25 76 25 96 41" fill="none" stroke="${COLORS.navy}" stroke-width="5.5" stroke-linecap="round"/>
      <circle cx="24" cy="41" r="4.6" fill="${COLORS.navy}"/>
      <circle cx="96" cy="41" r="4.6" fill="${COLORS.navy}"/>
      <path d="M30 64 C 52 86 84 84 104 58" fill="none" stroke="${COLORS.navyDark}" stroke-width="4" stroke-linecap="round" opacity="0.92"/>
    </g>
    <text x="118" y="46" font-family="${FONT_STACK}" font-size="40" font-weight="700" fill="${textColor}" letter-spacing="0.5">Giving</text>
    <text x="118" y="88" font-family="${FONT_STACK}" font-size="40" font-weight="700" fill="${textColor}" letter-spacing="0.5">Smiles</text>
  </svg>`
}
