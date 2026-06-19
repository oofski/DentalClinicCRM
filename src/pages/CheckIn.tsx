import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'
import { useToast } from '@/components/ui'
import { Icon } from '@/components/icons'
import type { KioskServerStatus } from '@shared/types'
import type { ImportedCheckIn } from '@shared/checkin'

export default function CheckIn() {
  const { mode, setMode } = useSession()

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>Patient Check-In</h1>
        <div className="row" style={{ gap: 6 }}>
          <button
            className={`btn btn-sm ${mode === 'online' ? 'btn-primary' : ''}`}
            onClick={() => setMode('online')}
          >
            🌐 Online
          </button>
          <button
            className={`btn btn-sm ${mode === 'offline' ? 'btn-primary' : ''}`}
            onClick={() => setMode('offline')}
          >
            🔌 Offline (USB)
          </button>
        </div>
      </div>

      {mode === 'online' ? <OnlineSection /> : <OfflineSection />}

      <div className="card">
        <div className="card-title">Use this computer as a station</div>
        <p className="muted" style={{ marginTop: -6 }}>
          No tablet? Open the check-in form full-screen on this computer and hand it to the patient.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => api.kiosk.open('local')}>
            <Icon name="kiosk" size={16} /> Open on this computer (saves here)
          </button>
          <button className="btn" onClick={() => api.kiosk.open('offline')}>
            <Icon name="kiosk" size={16} /> Open USB station (saves to flash drive)
          </button>
        </div>
      </div>
    </div>
  )
}

function OnlineSection() {
  const toast = useToast()
  const [status, setStatus] = useState<KioskServerStatus>({ running: false, urls: [], port: null })
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.kioskServer.status().then(setStatus)
  }, [])

  useEffect(() => {
    const url = status.urls[0]
    if (status.running && url) {
      QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null))
    } else setQr(null)
  }, [status])

  const start = async () => {
    setBusy(true)
    const res = await api.kioskServer.start()
    setBusy(false)
    if (res.ok && res.status) {
      setStatus(res.status)
      toast.push(
        res.status.urls.length ? 'Tablet check-in is live on your local network' : 'Started — connect this computer to wifi/hotspot',
        res.status.urls.length ? 'success' : 'info'
      )
    } else toast.push(res.error || 'Could not start the server', 'error')
  }
  const stop = async () => {
    const res = await api.kioskServer.stop()
    if (res.status) setStatus(res.status)
    toast.push('Tablet check-in stopped', 'info')
  }

  return (
    <div className="card">
      <div className="card-title">
        Online — Tablet over local network
        {status.running ? (
          <button className="btn btn-sm btn-danger" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={start}>
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        The tablet just needs to be on the <b>same wifi or hotspot</b> as this computer — <b>no
        internet required</b>. When the patient finishes, they appear here instantly with a signed
        consent.
      </p>

      {status.running ? (
        status.urls.length === 0 ? (
          <div className="alert">
            Running, but this computer isn’t on a network yet. Connect to wifi (or turn on a Windows
            hotspot), then Stop and Start again.
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 24, alignItems: 'center' }}>
            {qr && (
              <div style={{ textAlign: 'center' }}>
                <img src={qr} alt="QR code" style={{ width: 180, height: 180 }} />
                <div className="muted" style={{ fontSize: 12 }}>
                  Scan with the tablet camera
                </div>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Or open this link on the tablet:</div>
              {status.urls.map((u) => (
                <div
                  key={u}
                  className="pill azure"
                  style={{ display: 'block', marginBottom: 6, fontSize: 13, padding: '8px 12px' }}
                >
                  {u}
                </div>
              ))}
              <div className="alert success" style={{ marginTop: 8 }}>
                ✓ Live — new check-ins pop up automatically across the app.
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="alert info">
          Not running. Click <b>Start</b>, then on the tablet open the link (or scan the QR code).
        </div>
      )}
    </div>
  )
}

function OfflineSection() {
  const navigate = useNavigate()
  const toast = useToast()
  const [imported, setImported] = useState<ImportedCheckIn[] | null>(null)
  const [busy, setBusy] = useState(false)

  const doImport = useCallback(async () => {
    setBusy(true)
    const res = await api.checkin.importFromUsb()
    setBusy(false)
    if (!res.ok) {
      if (res.error !== 'Cancelled') toast.push(res.error || 'Import failed', 'error')
      return
    }
    setImported(res.imported || [])
    const n = res.imported?.length || 0
    if (n > 0)
      toast.push(`Imported ${n} patient${n === 1 ? '' : 's'}${res.failed ? `, ${res.failed} skipped` : ''}`, 'success')
    else
      toast.push(
        res.failed ? `No patients imported (${res.failed} file(s) couldn’t be read)` : 'No check-in files selected',
        res.failed ? 'error' : 'info'
      )
  }, [toast])

  return (
    <div className="card">
      <div className="card-title">Offline — USB flash drive</div>
      <p className="muted" style={{ marginTop: -6 }}>
        No network needed at all. The patient checks in on any device with the app, clicks <b>Save to
        Flash Drive</b>, you carry the drive to the doctor’s computer, then <b>Import</b> here. Files
        are encrypted with your unlock code, so a lost drive is unreadable.
      </p>

      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn btn-primary" onClick={() => api.kiosk.open('offline')}>
          <Icon name="kiosk" size={16} /> Open USB Check-In Station
        </button>
        <button className="btn btn-navy" disabled={busy} onClick={doImport}>
          <Icon name="doc" size={16} /> {busy ? 'Importing…' : 'Import from Flash Drive'}
        </button>
      </div>

      {imported && imported.length > 0 && (
        <div className="alert success" style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 6 }}>✓ Imported {imported.length} patient(s):</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {imported.map((p) => (
              <button
                key={p.id}
                className="btn btn-sm"
                onClick={() => navigate(`/patients/${p.id}`)}
              >
                {p.name} ({p.patient_id}) ›
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="muted" style={{ fontSize: 13, marginTop: 12, paddingLeft: 18 }}>
        <li>On the patient device: <b>Open USB Check-In Station</b> → patient fills the form → signs → <b>Save to Flash Drive</b>.</li>
        <li>Move the USB drive to this computer.</li>
        <li>Click <b>Import from Flash Drive</b> and pick the file(s) — the patients and signed consents are added here.</li>
      </ol>
    </div>
  )
}
