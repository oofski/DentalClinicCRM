type IconName =
  | 'home'
  | 'users'
  | 'settings'
  | 'plus'
  | 'logout'
  | 'tooth'
  | 'doc'
  | 'search'
  | 'image'
  | 'print'
  | 'mail'
  | 'check'
  | 'edit'
  | 'back'
  | 'kiosk'

const PATHS: Record<IconName, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5 10v10h14V10'],
  users: [
    'M17 21v-2a4 4 0 0 0-3-3.87',
    'M7 21v-2a4 4 0 0 1 3-3.87',
    'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  ],
  settings: ['M4 7h10', 'M18 7h2', 'M4 12h2', 'M10 12h10', 'M4 17h8', 'M16 17h4',
    'M14 5.5v3', 'M8 10.5v3', 'M14 15.5v3'],
  plus: ['M12 5v14', 'M5 12h14'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  tooth: [
    'M12 3c-2 0-2.7 1-4.5 1S4 4.2 4 8c0 3 .8 5 1.5 8.5C6 19 6.5 21 7.5 21S9 18 9.4 16c.3-1.4.9-2 2.6-2s2.3.6 2.6 2c.4 2 1.1 5 1.9 5s1.5-2 2-4.5C19.2 13 20 11 20 8c0-3.8-1.7-4-3.5-4S14 3 12 3z'
  ],
  doc: ['M14 3v4a1 1 0 0 0 1 1h4', 'M16 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M9 13h6', 'M9 17h4'],
  search: ['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'],
  image: ['M3 5h18v14H3z', 'M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M21 16l-5-5L5 21'],
  print: ['M6 9V3h12v6', 'M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2',
    'M6 14h12v7H6z'],
  mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
  check: ['M20 6 9 17l-5-5'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  kiosk: ['M4 4h16v12H4z', 'M9 20h6', 'M12 16v4']
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
