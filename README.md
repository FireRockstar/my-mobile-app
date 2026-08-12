# BenchDesk TV Repair CRM — Mobile App Setup

This folder is a complete Vite + React project with your CRM already wired in
at `src/App.jsx`, plus Capacitor config to package it as a native Android/iOS app.

## 1. Install dependencies

```bash
npm install
```

## 2. Preview in the browser first (sanity check)

```bash
npm run dev
```
Open the local URL it prints. Confirm everything looks right before packaging.

To preview on your **phone** over Wi-Fi while developing:
```bash
npm run dev -- --host
```
Then open `http://<your-computer's-LAN-IP>:5173` on your phone's browser
(same Wi-Fi network required).

## 3. Add the native platforms

You only do this once per platform.

```bash
npx cap init   # if prompted, appId/appName are already set in capacitor.config.ts — just confirm
npm run build
npx cap add android
npx cap add ios      # macOS + Xcode only
```

## 4. Open and run in the native IDE

```bash
npm run cap:android   # opens Android Studio — click Run ▶ with your phone plugged in (USB debugging on)
npm run cap:ios       # opens Xcode (macOS only) — select your device, click Run ▶
```

**Android requirements:** Android Studio installed, a phone with
Developer Options + USB Debugging enabled, connected via USB.

**iOS requirements:** a Mac with Xcode installed, an Apple ID for code
signing, and your iPhone connected via USB (or use the Simulator, no
device needed).

## 5. After you change App.jsx

Any time you edit the CRM code, re-sync before running again:
```bash
npm run cap:sync
```
This rebuilds the web assets and copies them into the native projects.

## Notes on what was changed from your original file

- Renamed the file to `src/App.jsx` and left the component itself untouched
  (`export default function TVRepairCRM()`), just imported it from `main.jsx`.
- Added a `smartPrint()` helper that calls `window.print()` in the browser
  (unchanged behavior) but opens the OS share sheet when running inside the
  native app shell, since Android's WebView doesn't support `window.print()`
  out of the box. You can swap this later for a proper PDF-export flow if
  you want true one-tap printing from the app.
- Everything else — all your screens, styling, and in-memory state — is
  exactly as you wrote it. Note the CRM's data (jobs, customers, invoices)
  lives in React state only, so it resets whenever the app is closed. If you
  want it to persist between sessions, that's a separate step (e.g. wiring
  up `@capacitor/preferences` or a local SQLite plugin) — let me know if
  you'd like that added.
