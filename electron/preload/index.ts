import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
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
    printSummary: (id: number) => invoke('patient:printSummary', id)
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
    reveal: (path: string) => invoke('doc:reveal', path)
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
    recent: (limit?: number) => invoke('audit:recent', limit)
  },
  data: {
    openFolder: () => invoke('data:openFolder'),
    backup: () => invoke('data:backup')
  },
  app: {
    info: () => invoke('app:info')
  },
  kiosk: {
    open: () => invoke('kiosk:open')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type GivingSmilesApi = typeof api
