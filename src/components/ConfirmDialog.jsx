import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Question, WarningOctagon } from '@phosphor-icons/react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback((options) => {
    const config = typeof options === 'string' ? { message: options } : options || {}

    return new Promise((resolve) => {
      resolver.current = resolve

      setRequest({
        title: config.title || 'Please confirm',
        message: config.message || 'Are you sure?',
        confirmLabel: config.confirmLabel || 'Confirm',
        cancelLabel: config.cancelLabel || 'Cancel',
        danger: Boolean(config.danger)
      })
    })
  }, [])

  const respond = useCallback((result) => {
    if (resolver.current) {
      resolver.current(result)
      resolver.current = null
    }

    setRequest(null)
  }, [])

  useEffect(() => {
    if (!request) return undefined

    function onKeyDown(event) {
      if (event.key === 'Escape') respond(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [request, respond])

  const Icon = request?.danger ? WarningOctagon : Question

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {request && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => respond(false)}
        >
          <div
            className="modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`modal-icon${request.danger ? ' is-danger' : ''}`} aria-hidden="true">
              <Icon size={22} weight="duotone" />
            </div>

            <h2 id="confirm-dialog-title">{request.title}</h2>

            <p id="confirm-dialog-message">{request.message}</p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => respond(false)}
              >
                {request.cancelLabel}
              </button>

              <button
                type="button"
                className={request.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => respond(true)}
                autoFocus
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)

  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }

  return context
}
