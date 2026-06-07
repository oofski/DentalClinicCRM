# Giving Smiles — Product Map (v1.1.1)

**Giving Smiles** is an offline Windows desktop application for a single dental clinic. It runs the full clinical workflow — **Patient Intake → Signed Consent → Clinical Examination → Treatment Report** — with everything stored locally on the clinic computer. No internet, no cloud, no subscription.

- **Platform:** Windows 10/11 desktop app (NSIS installer + portable build)
- **Works fully offline** — no data leaves the computer (unless you explicitly email a report)
- **Permanent download:** `…/releases/latest/download/GivingSmiles-Setup.exe`
- **Languages:** English, Spanish, Arabic (patient-facing); English (clinician portal)

---

## 1. Accounts & Roles

Three accounts are created on first launch. Default password `GivingSmiles2026` (changeable).

| Capability | Front Desk | Doctor | Admin |
|---|:---:|:---:|:---:|
| Sign in / change own password | ✅ | ✅ | ✅ |
| Register & edit patients (intake) | ✅ | ✅ | ✅ |
| Patient Check-In kiosk | ✅ | ✅ | ✅ |
| Capture signed consent | ✅ | ✅ | ✅ |
| View patient records & documents | ✅ | ✅ | ✅ |
| Upload / view patient images | ✅ | ✅ | ✅ |
| Print patient summary | ✅ | ✅ | ✅ |
| Clinical exam: tooth chart, notes, treatment plan | 👁 view only | ✅ | ✅ |
| Generate / print / email treatment reports | 👁 view only | ✅ | ✅ |
| Delete a patient | — | ✅ | ✅ |
| Clinic settings, SMTP, branding | — | — | ✅ |
| Manage user accounts | — | — | ✅ |
| Database backup & activity log | — | — | ✅ |

Seeded accounts: **`sidharthrane`** (Admin), **`drseitz`** (Doctor), **`frontend`** (Front Desk).

---

## 2. Core Modules & Features

### 2.1 Authentication & Security
- Username/password login with **bcrypt-hashed** passwords
- **Role-based access** (admin / doctor / front desk)
- **Auto-logout after 30 minutes** of inactivity
- **Activity log** (who did what, when) — admin-visible
- Hardened Electron shell: context isolation on, Node integration off, typed preload bridge, strict Content-Security-Policy, sandboxed document rendering
- Restricted internal `gsmedia://` channel for serving patient images (path-validated)

### 2.2 Patient Intake
- Full profile: name, DOB, contact, address, emergency contact
- **Medical history quick-pick chips** — common allergies (Penicillin, Latex, Aspirin/NSAIDs, Local anesthetic, Sulfa, Codeine, None) and conditions (Diabetes, High blood pressure, Heart disease, Asthma, Bleeding disorder, Pregnancy, None) + an **"Other"** free-text box
- Medications free-text; dental history free-text
- **Auto-generated Patient ID** (e.g. `GS-000123`)
- **Draft auto-save** so nothing is lost mid-entry
- Required-field validation; edit any time
- Fast search by name or ID (global search bar + Patients list)

### 2.3 Patient Check-In Kiosk (patient-facing "front-facing form")
- Full-screen, friendly flow you hand to the patient on a clinic touchscreen
- **Patient picks their language** (English / Spanish / Arabic) and the **entire intake form translates**, including the allergy/condition chips
- Flows straight into the consent form and signature
- Saves the new patient + signed consent ready for the doctor
- The clinician portal stays in English regardless of the patient's choice

### 2.4 Patient Record Dashboard
- Header: name, Patient ID, DOB + age, contact, preferred language, last visit
- **Red medical-alert banner** when allergies/conditions are present
- Tabs: **Overview · Medical History · Dental History · Forms & Documents · Examinations · Images**
- Quick actions: Edit, Print Summary, Sign Consent, New Examination (clinical), Delete (clinical)

### 2.5 Interactive Tooth Chart
- **32 anatomically-shaped teeth laid out as a real dental arch** ("a build of the mouth," not squares), Universal Numbering 1–32, upper & lower
- **7 colour-coded conditions:** Healthy, Cavity, Filled, Missing, Implant, Needs Treatment, Unexamined
- Per-tooth **surfaces** (Occlusal, Buccal, Lingual, Mesial, Distal) and a **quick note**
- **Quick-paint brush:** pick a condition, click teeth to mark them fast
- **"Mark all, then work backwards":** set every tooth to one condition (e.g. Healthy) and only change the exceptions; plus "Reset chart"
- Live counts per condition, hover read-outs, click-to-edit side panel
- Auto-saves; the same chart is embedded into the printed report

### 2.6 Clinical Notes
- Four note types: **Examination Finding, Treatment Plan, Follow-up, Special Observation**
- **Auto-save** as you type; edit or delete; "edited" marker
- **Link notes to specific teeth**
- **Quick templates** (one-tap common phrases)
- **🎤 Dictate (offline voice typing):** focuses the box and uses Windows' built-in dictation (**Win + H**) to type what you say — nothing leaves the computer

### 2.7 Treatment Plan
- Line items with **description, tooth, priority (Urgent / Important / Routine), estimated timeline, and optional cost**
- Auto-save; sorted by priority on the report
- **🎤 Dictate** support on the description fields

### 2.8 Treatment Report (the deliverable to the patient)
- One click generates a **professional PDF** containing:
  - Clinic header + Giving Smiles branding, patient details, medical alerts
  - **Embedded tooth-chart arch**, findings by condition with counts & tooth numbers
  - Clinical notes grouped by type; prioritised treatment-plan table; optional summary
  - Provider signature/approval block
- **Generated in the patient's language** (English/Spanish/Arabic, Arabic right-to-left) — labels & headings translate; your typed notes stay exactly as written (fully offline)
- **Approve & sign** (timestamps and marks the exam complete)
- Distribution: **Print** (real Windows print dialog → any printer), **Save as PDF** (archived to the patient's Reports folder), **Email** (one-click via SMTP if configured, otherwise opens your mail app and reveals the PDF to attach)

### 2.9 Consent Forms
- Professional, multi-section consent: **Treatment, Privacy/HIPAA, Liability, Emergency, Right to Refuse, Financial**
- **Three languages** (English / Spanish / Arabic with proper RTL)
- **On-screen signature pad** (mouse, touchpad, or touch); signatory name + timestamp
- **🔊 Read aloud** — reads the consent using the computer's built-in voice (offline)
- Generates a signed **PDF archived to the patient record**; provider counter-signature line

### 2.10 Document Archive
- Per-patient **Forms & Documents** tab listing every consent and report with dates
- **Open / Print**, reveal in folder, and **Email** actions
- Files organised on disk: `PatientFiles\<Patient ID>\{Consents, Reports, Images}`

### 2.11 Image Management
- Upload X-rays / intraoral / before-after photos (file picker)
- Thumbnail gallery, full-size viewer, delete
- Stored locally per patient

### 2.12 Settings & Administration (Admin)
- **Clinic info** (name, address, phone, license #, email, default language) — appears on all forms/reports
- **Email delivery (optional SMTP)** for one-click report sending; blank = offline mail-client fallback
- **User management** — add/remove doctors, hygienists, front-desk accounts and set roles
- **Data & Backup** — one-click database backup (export `.db`), open the data folder
- **Activity log** viewer

---

## 3. Languages & Localization
| Area | English | Spanish | Arabic (RTL) |
|---|:---:|:---:|:---:|
| Consent form (content + signature labels) | ✅ | ✅ | ✅ |
| Consent read-aloud | ✅ | ✅ | ✅ |
| Patient Check-In kiosk (form + chips) | ✅ | ✅ | ✅ |
| Treatment report (labels/headings) | ✅ | ✅ | ✅ |
| Clinician portal | ✅ | — | — |

---

## 4. Privacy & Offline Posture
- **All patient data stays on the clinic computer** — `%APPDATA%\giving-smiles\GivingSmilesData\`
- SQLite database (`givingsmiles.db`) + per-patient file folders
- **No telemetry, no cloud, no internet dependency** for any core function
- The only outbound action is **if a user chooses to email a report** (and only then)
- Voice typing and read-aloud both use **on-device** OS features — audio never leaves the machine

---

## 5. The End-to-End Workflow
1. **Front desk** registers the patient (or hands them the **Check-In kiosk** to self-enter in their language)
2. Patient **reads & signs consent** (with optional read-aloud); signed PDF is archived
3. **Doctor** opens the record, starts an exam, marks the **tooth chart**, adds **clinical notes** (typed, templated, or **dictated**), and builds the **treatment plan**
4. Doctor clicks **Generate Report** → professional PDF in the patient's language
5. Doctor **approves/signs**, then **prints, emails, or saves** it
6. Everything is **archived** to the patient record for future visits

---

## 6. Branding
- Giving Smiles logo recreated in crisp SVG (azure heart + dental-floss + navy wordmark)
- Azure/navy theme across the app, forms, and reports; generated Windows app icon

---

## 7. Deployment & Updates
- **Windows installer** (NSIS) with Desktop/Start-menu shortcuts, plus a **portable** build
- Built automatically by GitHub Actions; **permanent "latest" download link**
- Install on any number of clinic computers (each keeps its own local data)
- Updating = run the new installer; **patient data is untouched** by upgrades (separate folder)
- Note: not code-signed yet (Windows SmartScreen → *More info → Run anyway*)

---

## 8. Not Included Yet (potential roadmap)
- Appointment scheduling / calendar
- Billing & insurance claim integration
- Cloud backup / multi-computer sync
- Multi-clinic / multi-location support
- Native mobile (iOS/Android) apps
- SMS / email appointment reminders
- Advanced analytics & dashboards
- Advanced image annotation/measurement
- AI "clean-up / summarise my dictation" (needs internet — intentionally omitted for privacy)
- Code-signing certificate (removes the SmartScreen prompt)

---

## 9. Version History
- **v1.0.0** — MVP: intake, multilingual consent + signature, patient dashboard, anatomical tooth chart, clinical notes, treatment report (print/PDF/email), document archive, images, auth, settings, kiosk.
- **v1.1.0** — Reports in patient's language; consent read-aloud; translated kiosk; quick-pick medical history; tooth-chart "mark all"; quick-delete patient; version display; trimmed Dental section.
- **v1.1.1** — Offline voice typing (🎤 Dictate) for clinical notes & treatment plan; permanent installer download link.

---

*Giving Smiles — built for a busy dental practice: every click has a purpose, every patient record stays private and local.*
