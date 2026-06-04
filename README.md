<div align="center">
  <img src="docs/screenshots/logo.png" width="120" alt="Giving Smiles"/>
  <h1>Giving Smiles — Dental Clinic Management</h1>
  <p>A professional offline Windows desktop application for patient intake, digital consent, clinical examinations with an interactive tooth chart, and automated, printable treatment reports.</p>
</div>

---

## What this is

**Giving Smiles** is a complete, offline-first desktop app for a single dental clinic. It runs as a real **Windows application** you install on your clinic computers — no internet, no cloud, no monthly fees. All patient data stays on the clinic computer in a local database.

It implements the full clinical workflow: **Intake → Consent (signed) → Examination (tooth chart + notes) → Treatment Report (print / email / save)**.

| Treatment report (page 1) | Treatment report (page 2) | Consent — Arabic (RTL) |
|---|---|---|
| ![](docs/screenshots/treatment-report-page1.png) | ![](docs/screenshots/treatment-report-page2.png) | ![](docs/screenshots/consent-arabic.png) |

## Key features

- **Patient intake** — full medical/dental history, auto-generated Patient ID, draft auto-save, search.
- **Digital consent forms** in **English, Spanish, and Arabic** (RTL) with on-screen signature capture, embedded into a professional PDF and archived to the patient record.
- **Patient record dashboard** — medical alerts, history, documents, exams, and images in tabs.
- **Interactive tooth chart** — 32 anatomically-shaped teeth laid out as a real dental arch (a "build of the mouth", not squares). Click to set condition, surfaces, and notes; quick-paint mode; live counts; color-coded legend.
- **Clinical notes** — typed findings/treatment-plan/follow-up notes with auto-save and tooth links.
- **Treatment plan** — prioritised (urgent / important / routine) items with timeline and cost.
- **Treatment report** — auto-generated, professional PDF embedding the tooth chart. **Prints reliably** (uses the OS print pipeline), **exports to PDF**, and **emails** to the patient.
- **Patient Check-In (kiosk)** — a clean full-screen, patient-facing intake + consent flow you can hand to a patient on a clinic touchscreen (this is the "front-facing form").
- **Accounts & security** — three roles, bcrypt-hashed passwords, 30-minute inactivity auto-logout, activity log.
- **Settings** — clinic info, optional SMTP for one-click report emailing, user management, and database backup.

## Sign-in accounts

Three accounts are created automatically on first launch:

| Username | Name | Role | Access |
|---|---|---|---|
| `sidharthrane` | Sidharth Rane | **Admin** | Everything + settings, users, backup, activity log |
| `drseitz` | Dr. Seitz | **Doctor** | Full clinical: exams, tooth chart, reports |
| `frontend` | Front End | **Front Desk** | Intake, consent, check-in, document archive (view) |

**Default password for all three: `GivingSmiles2026`** — change it in **Settings → Change My Password** after first sign-in.

## Getting the Windows app

You don't build anything by hand. There are two ways to get the installer:

### Option A — Download the pre-built installer (recommended)
This repository includes a GitHub Actions workflow that builds the Windows installer automatically.
1. In GitHub, open the **Actions** tab → **Build Windows Installer** → the most recent run.
2. Download the **`GivingSmiles-Windows`** artifact (a zip).
3. Inside you'll find **`GivingSmiles-Setup-1.0.0.exe`** (installer) and a portable `.exe`.
4. Copy the installer to each clinic computer and run it. (Windows SmartScreen may warn about an unsigned app — choose *More info → Run anyway*. See [BUILD_AND_INSTALL.md](BUILD_AND_INSTALL.md) about code signing.)

### Option B — Build it yourself on a Windows PC
```bat
npm install
npm run dist:win
```
The installer appears in `release\1.0.0\`. Full steps in **[BUILD_AND_INSTALL.md](BUILD_AND_INSTALL.md)**.

## Running in development

```bash
npm install
npm run dev        # launches the app with hot reload
```

Useful scripts: `npm run build` (compile), `npm run typecheck`, `npm run dist:win` (Windows installer), `npm run dist:linux` (AppImage, for testing).

## Where data is stored

Everything is local to the clinic computer — **no data ever leaves the machine** (unless you explicitly email a report):

```
%APPDATA%\giving-smiles\GivingSmilesData\
├── givingsmiles.db            ← SQLite database (patients, exams, notes, users…)
└── PatientFiles\<Patient ID>\
    ├── Consents\              ← signed consent PDFs
    ├── Reports\               ← treatment report PDFs
    └── Images\                ← uploaded X-rays / photos
```

Back up the database any time from **Settings → Data & Backup → Back Up Database…**.

## Customising for your clinic

- **Clinic name / address / phone / license #** → Settings → Clinic Information (these appear on every form and report).
- **Consent wording** → edit `shared/consent.ts` (English/Spanish/Arabic). *Have your legal counsel review the consent language before use — the included text is a professional starting point, not legal advice.*
- **Email delivery** → Settings → Email Delivery. Leave blank to use the offline default (opens your mail app and reveals the PDF to attach), or enter SMTP details to email reports directly with the attachment.
- **Logo** → recreated in `shared/branding.ts` and `resources/icon.svg`.

## Architecture (for the maintaining developer)

- **Electron + React + TypeScript**, bundled with **electron-vite**, packaged with **electron-builder** (NSIS installer + portable).
- **Database:** SQLite via **sql.js** (WebAssembly — no native modules, so the Windows build is reliable). Synchronous write-through persistence with atomic file replace.
- **Main process** (`electron/main/`): database, repositories, auth (bcryptjs), file storage, PDF/print engine, email, and all IPC handlers.
- **Renderer** (`src/`): React UI, routed with React Router (`HashRouter`).
- **Shared** (`shared/`): types, dental reference data, consent content, branding, and the tooth-chart geometry/SVG — used by both the interactive chart and the printed report so they always match.
- **PDF & printing:** documents are rendered as HTML and converted via Electron's own print engine — `printToPDF()` for export/email and the system print dialog for physical printing, which is why printing is reliable across printers.
- **Security:** `contextIsolation` on, `nodeIntegration` off, a typed `contextBridge` preload, a restricted `gsmedia://` protocol for serving patient images, and a strict CSP.

See `electron/main/index.ts` (app entry), `electron/main/ipc.ts` (API surface), and `src/components/ToothChart.tsx` (the chart).
