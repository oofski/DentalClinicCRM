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

### New in v1.1.0
- **Treatment reports in the patient's language** — headings/labels render in English, Spanish, or Arabic (RTL) based on the patient's preference. Your typed notes stay exactly as written. Fully offline.
- **Read consent aloud** — a button reads the consent form using the computer's built-in voice (offline; Spanish/Arabic use Windows language voices if installed).
- **Translated Check-In** — the patient kiosk form (labels + common allergy/condition picks) appears in the patient's chosen language; the doctor portal stays English.
- **Quick-pick medical history** — common allergies & conditions as one-tap chips, with an "Other" box; medications stay free-text.
- **Tooth chart "mark all, then work backwards"** — set every tooth to one condition (e.g. Healthy) and change only the exceptions.
- **Quick-delete a patient** (Doctor/Admin) — removes the record; signed PDFs stay archived on disk.
- **Version number** shown at the bottom of the sidebar; simplified Dental section (Referring Doctor & Insurance removed).

### New in v1.1.1
- **Voice typing (offline)** — a 🎤 Dictate button in Clinical Notes, Treatment Plan, and the Report summary focuses the field and lets you dictate with your computer's built-in voice typing (Windows **Win + H**). No internet, and nothing leaves the computer.

### New in v1.2.0
- **Events (per-event patient grouping)** — admins create an event (name, location, date); set one **active** and every new check-in (front desk or tablet) is auto-tagged to it. Filter patients by event, change a patient's event on their record, and **Export Event Folder** copies all tagged patients' files + a roster CSV into one folder (USB, etc.).
- **Tablet check-in over local network** — Settings → *Tablet Check-In* starts a small on-device server; a tablet on the **same wifi/hotspot (no internet)** opens the link or scans the QR code, the patient completes intake + consent + signature, and they appear in the app instantly with a signed consent.
- **Referral templates** — admins/doctors create reusable referral letters per receiving clinic (Settings → *Referral Templates*); generate a referral from any patient record and **print or email** it (auto-pulls medical alerts + latest findings, optional tooth-chart image).
- **Extraction tooth condition** — a new purple **Extraction** status on the tooth chart, included in the legend, counts, and translated reports.

### New in v1.2.1
- **Auto-update** — *Settings → Software Updates* (admin) checks this repo's releases, downloads the new version with a progress bar, and installs in place with **Restart & Install** — no more manual re-downloads. A quiet check also runs at startup (offline clinics are unaffected; patient data is never touched by updates).

### New in v1.2.2
- **Show password** toggle on the sign-in screen.
- **Delete events** directly (admin) — from the Events page you can now delete an event outright; its patients are kept and simply untagged (records and files untouched), so you're no longer limited to archiving.

### New in v1.2.3
- **Single bootstrap admin** — a fresh install now starts with one generic `admin` / `admin123` login; the login screen no longer shows any credentials. Create your own staff logins from Settings → User Management and change the password.
- **Activity log management** (admin) — **Download CSV** and **Clear Log** buttons in Settings.
- **Trademark / legal** — *Giving Smiles™ — © 2026 Software Smiles* notices added to the app, the PDF documents, and the installer metadata.

### New in v1.2.4
- **Reliable auto-update** — fixed update checks failing with a GitHub `releases.atom` 404 (GitHub rate-limits that feed for unauthenticated clients). The updater now reads the `latest.yml` manifest directly from the stable `releases/latest/download` URL, which isn't rate-limited. *(Auto-update requires the repository to be public so the app can read releases without a login.)*

### New in v1.2.5
- **Trademark wording** — the ™ now sits on **Software Smiles™** (the company), not on the Giving Smiles product, across the app, PDFs, and installer metadata.

### New in v1.2.6
- **License gate (offline, no server)** — each computer must enter a one-time **unlock code** before the app can be used. The installer stays freely downloadable but is inert without the code, so you control who can actually run it — and the repo can stay public (auto-update keeps working). Only the bcrypt *hash* of the code lives in the repo; change the code anytime with `node scripts/make-unlock-hash.mjs "NEW-CODE"` and paste the hash into `electron/main/license.ts`.

### New in v1.2.7
- **Online / Offline check-in modes** — pick a mode right on the **sign-in screen** (and switch any time from the new **Check-In** page or the mode pill in the top bar).
  - **🌐 Online** — the existing tablet flow: a tablet on the **same wifi/hotspot (no internet)** scans the QR code or opens the link, and the patient appears in the app instantly with a signed consent.
  - **🔌 Offline (USB)** — no network at all. The patient checks in on any computer running the app and clicks **Save to Flash Drive**; you carry the USB drive to the doctor's computer and click **Import from Flash Drive** to pull the patient and signed consent in. Each file is **encrypted with your unlock code** (AES‑256‑GCM), so a lost drive is unreadable.
- **Check-In hub** — a dedicated page consolidates both modes plus a "use this computer as a station" option (online or USB), replacing the old *Settings → Tablet Check-In* panel.

### New in v1.2.8
- **Reliable user creation** — fixed *Settings → Provider & Staff Accounts → Add Account* failing silently. Creating a login now validates clearly (name, username, password ≥ 6 chars), shows a **Show password** option, reports any problem with a message instead of doing nothing, and **reusing a removed username** revives that account instead of hitting a hidden database error.
- **Set / reset a password** — admins can set a new password for any existing user from the accounts list (**Set Password**), without needing the old one — handy when a staff member is locked out.

### New in v1.2.9 — Doctor charting zone
- **Auto-charting → Clinical Notes** — when you tag a tooth with a condition (Cavity, Implant, Extraction, …) and/or surfaces, a clinical-notes finding is written automatically, e.g. `#14 — Cavity (surfaces: M, O)`. Teeth left **Healthy or unmarked are ignored**. Reverting a tooth removes its line, and the moment you hand-edit an auto-note it's yours to keep (never overwritten). Bulk "Mark all" won't flood the list.
- **Clinical Note → Treatment Plan** — each note has a **To plan** button that drops it into the Treatment Plan, where you pick a **Recommended Treatment** (Filling, Crown, Root Canal, Extraction, Referral, …) and a **Timeline** (ASAP → 6 months) from clean dropdowns, plus a free-text details line.
- **"Treatment Report" is now "Additional Notes"** — renamed across the app, the PDF heading (English/Spanish/Arabic), and the patient record.
- **Nicer tooth-tagging panel** — the condition and surface pickers are re-laid-out as tidy grids (conditions in two even columns, surfaces as five compact labelled chips) instead of buttons stacked on top of each other.

### New in v1.3.0 — Dental Scribe (offline dictation → chart)
- **Dental Scribe** in the exam screen (**Clinical Notes → 🦷 Dental Scribe**) turns a dictated/typed exam narrative into structured charting — **fully offline, no AI service, no cloud**:
  - **Dental term correction** — fixes common dictation slips (e.g. *buckle → buccal, carries → caries, distil → distal*) from a built-in dental lexicon.
  - **Tooth-notation reading** — understands **Universal (1–32), FDI, and Palmer** references (e.g. "FDI 26", "UR6", "upper right first molar") and normalizes them to the chart's Universal numbers.
  - **Structured findings** — detects conditions (cavity, filling, implant, extraction, crown/RCT…) and surfaces (incl. shorthand like **MOD**), and proposes tooth-chart tags, treatment-plan items, and a cleaned clinical note.
  - **Review-gated** — everything is shown for you to check/uncheck before it's applied; **nothing is saved until you click Apply**. Ambiguous terms (e.g. reversible vs. irreversible pulpitis) are flagged.
  - Applied tooth tags also auto-generate the per-tooth clinical notes from v1.2.9.

  *The offline dental-language approach is adapted from [DentaScribe](https://github.com/Victor-lyhan/dentascribe) (MIT license). Giving Smiles reimplements the lexicon-correction and tooth-notation ideas in TypeScript so no Python, ML models, or network are required; raw speech-to-text still comes from Windows voice typing.*

### New in v1.3.1
- **Raw capture** — dictation is no longer auto-corrected while you speak; dental terms are cleaned up only when you press **Analyze**, so nothing fights you mid-sentence.
- **Dictation lands in the right box** — the 🎤 button now targets the Scribe box explicitly instead of "whichever field was last clicked", and speech appends at the end rather than overwriting.
- **"All other teeth are healthy"** — the scribe recognises blanket statements ("the rest are WNL", "everything else is normal", …) and offers to mark every remaining tooth Healthy in one reviewed step.
- **Unfinished dictation is remembered** if you close the window before applying.

### New in v1.3.2
- **Fixed: Windows voice typing produced no text in the Dental Scribe box.** Two of our own mechanisms were interfering with the OS dictation pathway:
  - The dictation box was a React *controlled* input. Windows voice typing inserts text through the OS Text Services Framework (the same route an IME uses), and re-rendering the box mid-insertion cancelled it. The box is now **uncontrolled**, so it behaves like Notepad and React never touches text while Windows is writing it.
  - The old **Start capture** mode re-focused the box and moved the caret every 400 ms, which could interrupt an in-flight insertion. That mode is **removed** — there is no capture button any more; simply click in the box and press **Win + H**.
- **Live word counter** above the box, so you can see at a glance whether Windows is actually delivering text.

## Sign-in accounts

A fresh install bootstraps with a **single administrator** account:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | **Administrator** |

Sign in as `admin`, then create your clinic's own staff logins (doctor / front desk) and change the admin password from **Settings → User Management** and **Settings → Change My Password**. *(Already-installed machines keep whatever accounts they already had — this only applies to fresh installs.)*

## Getting the Windows app

**⬇️ Permanent download link (always the newest version):**
**https://github.com/oofski/DentalClinicCRM/releases/latest/download/GivingSmiles-Setup.exe**
(portable: `…/releases/latest/download/GivingSmiles-Portable.exe`)

You don't build anything by hand. There are two ways to get the installer:

### Option A — Download the pre-built installer (recommended)
This repository includes a GitHub Actions workflow that builds the Windows installer automatically.
1. In GitHub, open the **Actions** tab → **Build Windows Installer** → the most recent run.
2. Download the **`GivingSmiles-Windows`** artifact (a zip).
3. Inside you'll find **`GivingSmiles-Setup.exe`** (installer) and a portable `.exe`.
4. Copy the installer to each clinic computer and run it. (Windows SmartScreen may warn about an unsigned app — choose *More info → Run anyway*. See [BUILD_AND_INSTALL.md](BUILD_AND_INSTALL.md) about code signing.)

### Option B — Build it yourself on a Windows PC
```bat
npm install
npm run dist:win
```
The installer appears in `release\<version>\`. Full steps in **[BUILD_AND_INSTALL.md](BUILD_AND_INSTALL.md)**.

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
