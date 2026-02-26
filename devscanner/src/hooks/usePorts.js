import { useState, useCallback } from 'react'
import electron from '../electronApi'

export default function usePorts() {
  const [ports, setPorts] = useState([])
  const [portsScanning, setPortsScanning] = useState(false)
  const [portsScanMode, setPortsScanMode] = useState('common')
  const [portsError, setPortsError] = useState(null)
  const [killingPids, setKillingPids] = useState(new Set())

  const scanPorts = useCallback(async (mode) => {
    setPortsScanning(true)
    setPortsError(null)
    const result = await electron.scanPorts({ mode: mode || portsScanMode })
    if (result.success) {
      setPorts(result.data)
    } else {
      setPortsError(result.error)
    }
    setPortsScanning(false)
  }, [portsScanMode])

  const handleKillPort = useCallback(async (pid, signal) => {
    if (!pid) return
    setKillingPids(prev => new Set([...prev, pid]))
    const result = await electron.killPortProcess({ pid, signal })
    if (result.success) {
      setTimeout(() => scanPorts(), 500)
    }
    setKillingPids(prev => {
      const next = new Set(prev)
      next.delete(pid)
      return next
    })
  }, [scanPorts])

  return {
    ports,
    portsScanning,
    portsScanMode,
    setPortsScanMode,
    portsError,
    killingPids,
    scanPorts,
    handleKillPort
  }
}
