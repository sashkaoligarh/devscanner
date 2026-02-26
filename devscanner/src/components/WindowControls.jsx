import React from 'react'
import { Minus, Maximize2, Minimize2, X } from 'lucide-react'
import electron from '../electronApi'

export default function WindowControls({ isMaximized }) {
  return (
    <div className="window-controls">
      <button
        className="wc-btn wc-minimize"
        onClick={() => electron.windowMinimize()}
        title="Minimize"
      >
        <Minus size={11} />
      </button>
      <button
        className="wc-btn wc-maximize"
        onClick={() => electron.windowMaximize()}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>
      <button
        className="wc-btn wc-close"
        onClick={() => electron.windowClose()}
        title="Close"
      >
        <X size={11} />
      </button>
    </div>
  )
}
