import React from 'react'
import { Clock, CheckCircle, XCircle } from 'lucide-react'

export default function HealthIndicator({ status }) {
  if (!status) return null
  if (status === 'pending') return <span className="health-badge health-pending"><Clock size={11} /> checking</span>
  if (status === 'healthy') return <span className="health-badge health-ok"><CheckCircle size={11} /> healthy</span>
  return <span className="health-badge health-err"><XCircle size={11} /> unreachable</span>
}
