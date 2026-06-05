# Building & Installing Giving Smiles on Windows

This guide explains how to produce the Windows installer and put it on your clinic computers.

---

## 1. Easiest path — download the installer from GitHub Actions

Every push to GitHub automatically builds a Windows installer for you. You do **not** need any developer tools for this.

1. Open the repository on GitHub.
2. Click the **Actions** tab.
3. Click the workflow **“Build Windows Installer”**, then open the most recent successful run (green ✓).
4. Scroll to **Artifacts** and download **`GivingSmiles-Windows`** (a `.zip`).
5. Unzip it. You'll get:
   - **`GivingSmiles-Setup.exe`** — the installer (recommended).
   - **`GivingSmiles-Portable.exe`** — a portable version that runs without installing.

To build on demand without pushing code: **Actions → Build Windows Installer → Run workflow**.

To produce a versioned **Release** with the installer attached, push a tag:
```bash
git tag v1.1.0
git push origin v1.1.0
```

---

## 2. Build it yourself on a Windows PC

Requirements: **Windows 10/11**, **[Node.js 20 LTS](https://nodejs.org/)**, and **Git**.

```bat
git clone <your-repo-url>
cd DentalClinicCRM
npm install
npm run dist:win
```

When it finishes, the installer is in:
```
release\<version>\GivingSmiles-Setup.exe
```

> The build uses no native modules (the database engine is WebAssembly), so it compiles cleanly on a stock Node.js install — no Visual Studio build tools required.

---

## 3. Installing on clinic computers

1. Copy `GivingSmiles-Setup.exe` to the computer (USB drive, network share, etc.).
2. Double-click it. Choose the install location if prompted; it creates a Desktop and Start-menu shortcut.
3. Launch **Giving Smiles** and sign in (see accounts in the README).

### About the SmartScreen / “unknown publisher” warning
The installer is **not code-signed**, so Windows SmartScreen may show *“Windows protected your PC.”* Click **More info → Run anyway**. This is expected for unsigned apps and does not indicate a problem.

To remove the warning permanently, purchase a **code-signing certificate** (e.g. an OV/EV certificate from a CA) and add these to `electron-builder.yml` under `win:`:
```yaml
win:
  certificateFile: path\to\certificate.pfx
  certificatePassword: ${env.CSC_KEY_PASSWORD}
```
(or set the `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables in CI).

---

## 4. Updating to a new version

Build a new installer (bump `version` in `package.json`) and run it on each computer — it upgrades in place. **Patient data is never touched by reinstalling/upgrading** because it lives in `%APPDATA%\giving-smiles\GivingSmilesData\`, separate from the program files. Take a backup first from **Settings → Data & Backup** to be safe.

---

## 5. Using the patient-facing check-in (kiosk)

The patient intake + consent “front-facing form” runs inside the same app:

- Click **Patient Check-In** in the sidebar (or the Dashboard tile). A clean full-screen window opens.
- Hand that computer/touchscreen to the patient. They fill in their details and sign the consent.
- When they finish, their record and signed consent are already saved for the doctor.

A staff member must be signed in on the main app first (the kiosk uses that session).

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| SmartScreen blocks the installer | More info → Run anyway (unsigned app). See §3. |
| Printer dialog doesn't appear | Make sure a printer (or “Microsoft Print to PDF”) is installed in Windows. |
| Email button opens the mail app instead of sending | That's the offline default. Add SMTP details in **Settings → Email Delivery** for direct sending with attachment. |
| Forgot the admin password | Sign in as another admin to reset, or restore from a backup. (Passwords are securely hashed and cannot be recovered.) |
| Where is my data? | `%APPDATA%\giving-smiles\GivingSmilesData\` — open it from **Settings → Open Data Folder**. |
