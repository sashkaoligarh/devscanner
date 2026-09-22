import React, { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown } from 'lucide-react'

export default function CustomSelect({ value, onChange, options, placeholder, className = '', style, id, disabled = false, 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const generatedId = useId()
  const triggerId = id || generatedId
  const listId = `${triggerId}-options`

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (open && !disabled) {
      const option = ref.current?.querySelector('[aria-selected="true"]') || ref.current?.querySelector('[role="option"]')
      option?.focus()
    }
  }, [open, disabled])

  const handleKeyDown = e => {
    if (disabled) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const items = [...ref.current.querySelectorAll('[role="option"]')]
      const current = items.indexOf(document.activeElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }

  const selected = options.find(o => o.value === value)

  return (
    <div className={`custom-select ${className}`} ref={ref} style={style} onKeyDown={handleKeyDown}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? listId : undefined}
        className={`custom-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`custom-select-value${!selected ? ' placeholder' : ''}`}>
          {selected ? selected.label : (placeholder || 'Select...')}
        </span>
        <ChevronDown size={14} className={`custom-select-arrow${open ? ' open' : ''}`} />
      </button>
      {open && !disabled && (
        <div className="custom-select-dropdown" id={listId} role="listbox" aria-labelledby={triggerId}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`custom-select-option${opt.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); triggerRef.current?.focus() }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
