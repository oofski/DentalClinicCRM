import { useEffect } from 'react'
import { useToast } from './ui'

// Track the last editable field the user focused, so the Dictate button can put the
// cursor back there before the OS dictation starts.
let lastEditable: HTMLTextAreaElement | HTMLInputElement | null = null
let installed = false
function install() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement
    if (
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLInputElement && (t.type === 'text' || t.type === ''))
    ) {
      lastEditable = t
    }
  })
}

function platformName(): string {
  try {
    return window.api?.platform || ''
  } catch {
    return ''
  }
}

function tooltip(): string {
  const p = platformName()
  if (p === 'win32')
    return 'Voice-type into the box you last clicked using Windows dictation (Win + H) — works offline'
  if (p === 'darwin') return 'Voice-type using macOS Dictation — works offline'
  return 'Voice-type using your system dictation — works offline'
}

function hint(): string {
  const p = platformName()
  if (p === 'win32')
    return '🎤 Now press Win + H and speak. Say "period", "new line". Press Win + H again to stop.'
  if (p === 'darwin') return '🎤 Now start Dictation (Edit ▸ Start Dictation) and speak.'
  return '🎤 Now start your system voice dictation and speak.'
}

export function DictateButton({ small = true }: { small?: boolean }) {
  const toast = useToast()
  useEffect(() => {
    install()
  }, [])

  const onClick = () => {
    if (!lastEditable || !document.body.contains(lastEditable)) {
      toast.push('Click into a notes or treatment box first, then press Dictate.', 'info')
      return
    }
    lastEditable.focus()
    toast.push(hint(), 'info')
  }

  return (
    <button
      type="button"
      className={`btn ${small ? 'btn-sm' : ''}`}
      onClick={onClick}
      title={tooltip()}
    >
      🎤 Dictate
    </button>
  )
}
