import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// ---------------- Toasts ----------------
type ToastType = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  message: string
  type: ToastType
}
interface ToastApi {
  push: (message: string, type?: ToastType) => void
}
const ToastCtx = createContext<ToastApi>({ push: () => {} })
export const useToast = () => useContext(ToastCtx)

let toastId = 0
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastId
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------------- Modal ----------------
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="card-title">
          <span>{title}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div>{children}</div>
        {footer && (
          <div className="row between" style={{ marginTop: 20, justifyContent: 'flex-end', gap: 10 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------- Field ----------------
export function Field({
  label,
  required,
  error,
  children
}: {
  label: string
  required?: boolean
  error?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error && <span className="error-text">{error}</span>}
    </div>
  )
}
