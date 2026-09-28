import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle,
  error: WarningCircle,
  info: Info
}

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))

    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
  }, [])

  const show = useCallback((message, type = 'info', duration = 5000) => {
    const id = ++idCounter

    setToasts((current) => [...current, { id, message, type }])

    if (duration) {
      timers.current[id] = setTimeout(() => dismiss(id), duration)
    }

    return id
  }, [dismiss])

  const toast = useMemo(() => ({
    show,
    success: (message, duration) => show(message, 'success', duration),
    error: (message, duration) => show(message, 'error', duration ?? 7000),
    info: (message, duration) => show(message, 'info', duration),
    dismiss
  }), [show, dismiss])

  return (
    <ToastContext.Provider value={toast}>
      {children}

      <div className="toast-viewport" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((item) => {
          const Icon = ICONS[item.type] || Info

          return (
            <div key={item.id} className={`toast toast-${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}>
              <Icon className="toast-icon" size={20} weight="fill" aria-hidden="true" />

              <div className="toast-body">{item.message}</div>

              <button
                type="button"
                className="toast-close"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
              >
                <X size={16} weight="bold" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  return context
}
