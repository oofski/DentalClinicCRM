import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  license: {
    status: () => invoke('license:status'),
    activate: (code: string) => invoke('license:activate', code)
  },
  auth: {
    login: (username: string, password: string) => invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    current: () => invoke('auth:current'),
    changePassword: (oldPw: string, newPw: string) =>
      invoke('auth:changePassword', oldPw, newPw)
  },
  users: {
    list: () => invoke('users:list'),
    create: (args: { username: string; fullName: string; role: string; password: string }) =>
      invoke('users:create', args),
    deactivate: (id: number) => invoke('users:deactivate', id)
  },
  patients: {
    create: (input: unknown) => invoke('patients:create', input),
    update: (id: number, input: unknown) => invoke('patients:update', id, input),
    get: (id: number) => invoke('patients:get', id),
    search: (term: string) => invoke('patients:search', term),
    recent: (limit?: number) => invoke('patients:recent', limit),
    count: () => invoke('patients:count'),
    fullRecord: (id: number) => invoke('patients:fullRecord', id),
    printSummary: (id: number) => invoke('patient:printSummary', id),
    delete: (id: number) => invoke('patients:delete', id),
    setEvent: (id: number, eventId: number | null) => invoke('patients:setEvent', id, eventId)
  },
  events: {
    list: () => invoke('events:list'),
    create: (args: unknown) => invoke('events:create', args),
    update: (id: number, args: unknown) => invoke('events:update', id, args),
    setStatus: (id: number, status: string) => invoke('events:setStatus', id, status),
    delete: (id: number) => invoke('events:delete', id),
    setActive: (id: number | null) => invoke('events:setActive', id),
    getActive: () => invoke('events:getActive'),
    listPatients: (id: number) => invoke('events:listPatients', id),
    export: (id: number) => invoke('events:export', id)
  },
  reftpl: {
    list: () => invoke('reftpl:list'),
    create: (t: unknown) => invoke('reftpl:create', t),
    update: (id: number, t: unknown) => invoke('reftpl:update', id, t),
    delete: (id: number) => invoke('reftpl:delete', id)
  },
  referral: {
    generate: (args: unknown) => invoke('referral:generate', args),
    print: (args: unknown) => invoke('referral:print', args)
  },
  kioskServer: {
    start: () => invoke('kioskserver:start'),
    stop: () => invoke('kioskserver:stop'),
    status: () => invoke('kioskserver:status')
  },
  live: {
    onCheckin: (cb: (p: { id: number; name: string; patient_id: string }) => void) => {
      const listener = (_e: IpcRendererEvent, payload: { id: number; name: string; patient_id: string }) =>
        cb(payload)
      ipcRenderer.on('live:checkin', listener)
      return () => ipcRenderer.removeListener('live:checkin', listener)
    }
  },
  updates: {
    status: () => invoke('updates:status'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    install: () => invoke('updates:install'),
    onStatus: (cb: (s: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    }
  },
  exams: {
    create: (patientId: number, examDate: string) => invoke('exams:create', patientId, examDate),
    get: (id: number) => invoke('exams:get', id),
    listByPatient: (patientId: number) => invoke('exams:listByPatient', patientId),
    treatmentItems: (id: number) => invoke('exams:treatmentItems', id),
    saveChart: (id: number, data: unknown) => invoke('exams:saveChart', id, data),
    saveTreatmentItems: (id: number, items: unknown) =>
      invoke('exams:saveTreatmentItems', id, items),
    setStatus: (id: number, status: string) => invoke('exams:setStatus', id, status)
  },
  notes: {
    create: (examId: number, type: string, content: string, teeth: number[]) =>
      invoke('notes:create', examId, type, content, teeth),
    update: (id: number, content: string, teeth: number[]) =>
      invoke('notes:update', id, content, teeth),
    delete: (id: number) => invoke('notes:delete', id),
    listByExam: (examId: number) => invoke('notes:listByExam', examId)
  },
  consent: {
    generate: (args: unknown) => invoke('consent:generate', args),
    listByPatient: (patientId: number) => invoke('consent:listByPatient', patientId)
  },
  report: {
    generate: (args: unknown) => invoke('report:generate', args),
    print: (args: unknown) => invoke('report:print', args),
    listByPatient: (patientId: number) => invoke('report:listByPatient', patientId),
    email: (args: { pdfPath: string; to: string; patientName: string }) =>
      invoke('report:email', args)
  },
  doc: {
    open: (path: string) => invoke('doc:open', path),
    reveal: (path: string) => invoke('doc:reveal', path),
    email: (args: { pdfPath: string; to: string; subject: string; text: string }) =>
      invoke('doc:email', args)
  },
  images: {
    pick: () => invoke('images:pick'),
    add: (args: unknown) => invoke('images:add', args),
    delete: (id: number, filePath: string, deleteFile: boolean) =>
      invoke('images:delete', id, filePath, deleteFile)
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (partial: unknown) => invoke('settings:update', partial)
  },
  audit: {
    recent: (limit?: number) => invoke('audit:recent', limit),
    export: () => invoke('audit:export'),
    clear: () => invoke('audit:clear')
  },
  data: {
    openFolder: () => invoke('data:openFolder'),
    backup: () => invoke('data:backup')
  },
  app: {
    info: () => invoke('app:info')
  },
  kiosk: {
    open: (mode?: string) => invoke('kiosk:open', mode)
  },
  checkin: {
    saveBundle: (bundle: unknown) => invoke('checkin:saveBundle', bundle),
    importFromUsb: () => invoke('checkin:importFromUsb')
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type GivingSmilesApi = typeof api
