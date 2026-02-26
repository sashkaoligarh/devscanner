import { useState, useEffect } from 'react'
import electron from '../electronApi'

export default function useDockerServices() {
  const [serviceCatalog, setServiceCatalog] = useState(null)
  const [dockerServicesHealth, setDockerServicesHealth] = useState({})
  const [dockerServicesModal, setDockerServicesModal] = useState(null)

  // Load catalog and subscribe to health updates on mount
  useEffect(() => {
    if (!electron.available) return

    electron.dockerServicesCatalog().then(res => {
      if (res.success) setServiceCatalog(res.data)
    })

    electron.onDockerServicesHealth(({ projectPath, status }) => {
      setDockerServicesHealth(prev => ({ ...prev, [projectPath]: status }))
    })

    return () => {
      electron.removeDockerServicesHealthListener()
    }
  }, [])

  const openServicesModal = (project) => {
    setDockerServicesModal({ project })
  }

  const closeServicesModal = () => {
    setDockerServicesModal(null)
  }

  return {
    serviceCatalog,
    dockerServicesHealth,
    dockerServicesModal,
    openServicesModal,
    closeServicesModal
  }
}
