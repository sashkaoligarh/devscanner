import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export default function CustomSelect({ value, onChange, options, placeholder, className = '', style }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div className={`custom-select ${className}`} ref={ref} style={style}>
      <button
        type="button"
        className={`custom-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`custom-select-value${!selected ? ' placeholder' : ''}`}>
          {selected ? selected.label : (placeholder || 'Select...')}
        </span>
        <ChevronDown size={14} className={`custom-select-arrow${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="custom-select-dropdown">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-option${opt.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
