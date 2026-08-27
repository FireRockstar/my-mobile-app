import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Tv, LayoutDashboard, ClipboardList, Wrench, Package, Receipt, Users,
  MessageSquare, Plus, Printer, Search, X, Bell, RefreshCw, CheckCircle2,
  Clock, AlertTriangle, LogOut, Phone, ChevronRight, IndianRupee,
  Banknote, CreditCard, Smartphone, Trash2, UserCircle2, ArrowLeft,
  PackagePlus, PackageMinus, TrendingUp, CircleDot, Menu, Camera, MapPin, Eye, Mic, Upload,
  Download, BarChart3, Calendar
} from "lucide-react";
import { useFirestoreArrayState, useFirestoreValueState, useFirestoreLogState } from "./services/firestoreService";

/* ---------------------------------------------------------------------- */
/*  smartPrint — window.print() works fine in the browser, but Android's  */
/*  native WebView (used when this runs as a Capacitor app) doesn't wire  */
/*  it up to a print dialog at all, and simply sharing plain text (the    */
/*  old fallback) gives Android nothing printable to hand to a printer    */
/*  app — most Bluetooth label/receipt printer apps (RawBT, etc.) and the */
/*  Android Print Service only show up in the share sheet for an actual   */
/*  IMAGE or FILE, not text.                                              */
/*                                                                        */
/*  So on native we instead: render the printable area (passed in via a   */
/*  ref) to a PNG, write it to the app's cache directory, and hand that   */
/*  FILE to the OS share sheet — from there the user picks their label    */
/*  printer app, or "Print" if they have a print service installed.       */
/*                                                                        */
/*  Requires three packages that are NOT part of the base React app:      */
/*    npm install html2canvas @capacitor/filesystem @capacitor/share      */
/*    npx cap sync                                                        */
/*  If they aren't installed yet, this quietly falls back to the old      */
/*  text-only share so nothing crashes — but printing won't actually work */
/*  on a phone until those packages are added.                            */
/* ---------------------------------------------------------------------- */
function isNativeShell() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

async function smartPrint(printRef) {
  if (!isNativeShell()) {
    window.print();
    return;
  }
  try {
    const node = printRef?.current;
    if (!node) throw new Error("Nothing to print — missing printRef");

    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
    const dataUrl = canvas.toDataURL("image/png");
    const base64Data = dataUrl.split(",")[1];

    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const fileName = `label-${Date.now()}.png`;
    const { uri } = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Cache });

    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: "Print Label",
      text: "Choose your printer app (or Print) to print this.",
      files: [uri],
      dialogTitle: "Print / Share",
    });
  } catch (err) {
    // Missing packages, or nothing to capture — fall back so the button
    // never silently does nothing.
    console.warn("smartPrint: image share unavailable, falling back to text share.", err);
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: document.title, text: "Open this and choose Print from the share sheet." });
    } catch {
      window.print(); // last-resort fallback if @capacitor/share isn't installed either
    }
  }
}

/* ---------------------------------------------------------------------- */
/*  DESIGN TOKENS — "Bench Diagnostics" theme                             */
/*  charcoal bench + amber solder-iron accent + teal "good signal" state  */
/* ---------------------------------------------------------------------- */
const COLORS = {
  bg: "#F3E8FF",
  panel: "rgba(255,255,255,0.72)",
  panel2: "rgba(124,58,237,0.09)",
  border: "rgba(124,58,237,0.18)",
  borderLight: "rgba(124,58,237,0.30)",
  text: "#241C35",
  muted: "#6B5B8A",
  faint: "#9B8AB5",
  amber: "#F0A63A",
  amberDim: "#FCE7C6",
  teal: "#0D9488",
  tealDim: "#D6F1EE",
  red: "#E0453B",
  redDim: "#FBDCDA",
  blue: "#2E7DD6",
  /* glassmorphism tokens — translucent frosted-glass surfaces used across
     the dashboard shell (sidebar, topbar, panels, modals), tuned to sit
     on the holographic purple/pink/blue background below */
  glass: "rgba(255,255,255,0.68)",
  glass2: "rgba(255,255,255,0.82)",
  glassBorder: "rgba(124,58,237,0.16)",
  glassHighlight: "rgba(255,255,255,0.55)",
};

const FONT_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
const FONT_SANS = "'Inter', 'Segoe UI', system-ui, sans-serif";

/* ---------------------------------------------------------------------- */
/*  SEED DATA                                                              */
/* ---------------------------------------------------------------------- */
const now = Date.now();
const H = 3600000;

/* ---------------------------------------------------------------------- */
/*  2-HOUR REMINDER SYSTEM — constants & side-effect helpers               */
/* ---------------------------------------------------------------------- */
const REMINDER_INTERVAL_MS = 2 * H;
/* how often we poll for a newly-crossed 2h boundary. Keep this well under
   REMINDER_INTERVAL_MS — 60s is plenty and cheap. */
const REMINDER_POLL_MS = 60 * 1000;

/* Indoor/Outdoor Technicians never see the 2-hour customer-update cycle
   above (that's an Admin/Front Desk tool for messaging customers, and
   technicians can't see customer contact info). They instead get a
   simpler, faster 1-hour "check this job" nudge, scoped to only the
   jobs assigned to them. */
const TECH_REMINDER_INTERVAL_MS = 1 * H;

/* Separate again from both cycles above: a job with NO technician assigned
   yet gets Admin/Front Desk a "still needs a tech" nudge every 30 minutes,
   starting from intake, until someone assigns it. Stops the moment
   assignedTech is set. */
const UNASSIGNED_TECH_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

/* LABEL-PRINT REMINDER — Admin/Front Desk gets nudged when a job card's
   label hasn't been printed yet (is_label_printed = false). All timing
   here is Admin-controlled at runtime via notificationSettings.labelPrint
   (see Settings → Notification Settings → Label Print Reminder); the
   labelPrintDelayMs/labelPrintSnoozeMs helpers below read it live. */

/* Every distinct notification/reminder type in the app — each gets its
   own sound (preset or uploaded file), configured independently in
   Admin's Notification Settings. */
const NOTIFICATION_TYPE_META = {
  customerReminder: { label: "Customer Update Reminder (2-hour)" },
  dailySpareWait: { label: "Daily Spare-Wait Check-In" },
  techReminder: { label: "Technician Check-In Reminder (1-hour)" },
  unassignedReminder: { label: "Unassigned Job Reminder (30-min)" },
  previsitReminder: { label: "Pre-Visit Reminder (technician)" },
  techFollowup: { label: "Technician Follow-Up (Admin/Front Desk)" },
  quietModeCue: { label: "Add Job Screen — Quiet Mode Cue" },
  labelPrintReminder: { label: "Label Not Printed Reminder" },
  standbyTvReminder: { label: "Standby TV Due Back Reminder" },
};

const DEFAULT_NOTIFICATION_SOUND_CONFIG = { sound: "chime", customSoundUrl: null, customSoundName: null };

/* Admin-controlled notification settings — on/off and reminder delay per
   role, plus an independent sound (preset or uploaded file) per
   notification type. Defaults match the original hardcoded intervals
   above (120/60/30 minutes) so behavior is unchanged until Admin
   actually opens Settings and adjusts something. */
const DEFAULT_NOTIFICATION_SETTINGS = {
  admin: { enabled: true, customerReminderMin: 120, unassignedReminderMin: 30 },
  frontdesk: { enabled: true, customerReminderMin: 120, unassignedReminderMin: 30 },
  indoor_tech: { enabled: true, reminderMin: 60 },
  outdoor_tech: { enabled: true, previsitReminderMin: 30 },
  /* Label-print reminder — a single, role-independent dial (one physical
     label either got printed or it didn't, regardless of who's viewing),
     editable by Admin in Settings. Defaults match the original 30-min
     indoor / 1-hour outdoor / 10-min snooze behavior. */
  labelPrint: { enabled: true, indoorDelayMin: 30, outdoorDelayMin: 60, snoozeMin: 10 },
  /* Label-print ENFORCEMENT (separate from the reminder above) — a hard
     block, not just a nudge. When enabled, a job whose label hasn't been
     printed yet (isLabelPrinted = false) cannot be moved forward to a new
     status from Update Job / Repair Report; re-saving the SAME status
     (e.g. adding a note) is still allowed. Defaults to off so behavior is
     unchanged until Admin turns it on in Settings. */
  labelPrintEnforcement: { enabled: false },
  /* Standby TV reminder — fires once the customer-agreed loan period (set
     per-loan when Admin/Front Desk hands over the standby unit) runs out,
     nudging Admin/Front Desk to collect it back. Admin-editable snooze
     controls how soon it re-nags after "Remind Me Later". Defaults on. */
  standbyTv: { enabled: true, snoozeMin: 60 },
  sounds: Object.fromEntries(Object.keys(NOTIFICATION_TYPE_META).map((k) => [k, { ...DEFAULT_NOTIFICATION_SOUND_CONFIG }])),
};

/* Uploaded notification sound files are kept as an in-memory data: URL
   (no backend to upload to in this demo), so this caps the size to keep
   the app state light. */
const MAX_CUSTOM_SOUND_BYTES = 1.5 * 1024 * 1024; // 1.5 MB

const NOTIFICATION_SOUND_OPTIONS = [
  { value: "chime", label: "Chime (soft two-tone)" },
  { value: "beep", label: "Beep (sharp triple beep)" },
  { value: "alert", label: "Alert (urgent double buzz)" },
  { value: "silent", label: "Silent (no sound)" },
];

const NOTIFICATION_ROLE_META = {
  admin: { label: "Admin" },
  frontdesk: { label: "Front Desk" },
  indoor_tech: { label: "Indoor Technician" },
  outdoor_tech: { label: "Outdoor Technician" },
};

/* ---------------------------------------------------------------------- */
/*  SECTION-WISE FAULT SELECTION SYSTEM                                    */
/*  Each main fault category maps to a checklist of specific technical     */
/*  sub-sections (bilingual EN/Tamil labels). Categories not in this map   */
/*  (e.g. "Other") simply render no sub-checklist.                         */
/* ---------------------------------------------------------------------- */
const SUB_FAULTS = {
  "Motherboard Fault": [
    { en: "DC-DC Converter Section Fault", ta: "DC-DC செக்ஷன் ஃபால்ட்" },
    { en: "Audio / Amp Section Fault", ta: "ஆம்ப் / ஆடியோ செக்ஷன் ஃபால்ட்" },
    { en: "Power Supply Input Section Fault", ta: "பவர் சப்ளை செக்ஷன் ஃபால்ட்" },
    { en: "Processor / RAM Heat Issue", ta: "புராசஸர் / ரேம் பிரச்சனை" },
    { en: "Software / EMMC IC Issue", ta: "சாஃப்ட்வேர் / EMMC ஃபால்ட்" },
  ],
  "Display Fault": [
    { en: "COF Bonding Needed", ta: "காஃப் பாண்டிங் செய்ய வேண்டும்" },
    { en: "Scalar Board Fault", ta: "ஸ்கேலர் போர்டு கம்ப்ளைன்ட்" },
    { en: "Booster IC / Section Fault", ta: "பூஸ்டிங் செக்ஷன் ஃபால்ட்" },
    { en: "Pixel Shorting", ta: "பிக்சல் ஷார்ட்" },
    { en: "CKV / Gate Signal Shorting", ta: "கேட் சிக்னல் ஷார்ட்" },
  ],
  "SMPS / Power Supply Board": [
    { en: "Primary Switching Section Fault", ta: "பிரைமரி ஸ்விட்சிங் செக்ஷன்" },
    { en: "Secondary Output Voltage Section Fault", ta: "செகண்டரி வோல்டேஜ் ஃபால்ட்" },
    { en: "PFC Circuit Fault", ta: "PFC சர்க்யூட் ஃபால்ட்" },
    { en: "Standby 5V/3.3V Line Fault", ta: "ஸ்டாண்ட்பை லைன் ஃபால்ட்" },
  ],
  "Backlight Fault": [
    { en: "LED Strip Burning / Damage", ta: "எல்இடி ஸ்ட்ரிப் பர்ன் / சேதம்" },
    { en: "Backlight Driver IC Fault", ta: "பேக்லைட் டிரைவர் ஐசி ஃபால்ட்" },
    { en: "Voltage Inverter Board Issue", ta: "இன்வெர்ட்டர் போர்டு பிரச்சனை" },
  ],
};

/* Main fault categories offered at intake / update — the four detailed
   ones above, plus a few catch-alls that have no sub-checklist. */
const DEFAULT_FAULTS = [
  ...Object.keys(SUB_FAULTS),
  "No Power / Dead Set",
  "Sound Not Working",
  "Panel / Screen Damage",
  "Other",
];

/* Quick, plain-language symptom picker offered alongside the detailed
   Main Fault Category at job intake — a separate, simpler classification
   (not tied to any sub-fault checklist), and optional like the category
   itself. */
const GENERAL_FAULT_OPTIONS = ["No Audio", "No Video", "No Power On", "Dead", "Display Broken", "Display Lines"];

/* How many days a technician can pick when marking a job "Waiting for
   Spares" — during this window the 2-hour reminder cycle pauses in favor
   of one check-in per day. */
const SPARE_WAIT_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/* Preset "why is this In Progress" reasons shown as a dropdown on the
   Update Job form — picking one plus an optional custom note builds the
   progress note sent to the customer via SMS/WhatsApp. */
const IN_PROGRESS_REASONS = [
  "Diagnosing the fault",
  "Waiting for spare part",
  "Repairing component / board",
  "Replacing part",
  "Testing after repair",
  "Software / firmware update",
  "Cleaning / dust removal",
  "Other",
];

/* Closing line appended to the "detailed status update" WhatsApp/SMS
   message, keyed by the actual job status (not the display label) the
   technician picked in the reminder popup — covers every entry in
   MAIN_STATUS_OPTIONS and OTHER_SUB_STATUS_OPTIONS (defined further down,
   alongside STATUS_META) so every status in the "Current Status to Send"
   dropdown has a sensible customer-facing line. */
const STATUS_CLOSING_NOTE = {
  received: "Your TV has been received at our service center.",
  pending_diagnosis: "Your TV is in queue for diagnosis.",
  under_diagnosis: "We are currently diagnosing the fault.",
  fault_identified: "We have identified the fault and are preparing an estimate for you.",
  awaiting_approval: "We have sent an estimate — awaiting your approval to proceed.",
  approved_ok: "Thank you for approving — we will begin the repair shortly.",
  waiting_for_spares: "We have ordered the required spare part and will update you once it arrives.",
  in_repair: "We are currently working on component replacement.",
  ready_for_delivery: "Your TV is ready for delivery. Please visit at your convenience.",
  delivered: "Your TV has been delivered. Thank you for choosing us.",
  feedback_pending: "Thank you — we would appreciate your feedback on our service.",
  closed: "This job has been closed. Thank you for choosing us.",
  not_ready: "Unfortunately your TV could not be repaired.",
  spares_not_available: "The required spare part is currently unavailable — we will keep you posted.",
  approval_rejected: "As requested, we will not be proceeding with the repair.",
  exchange_requested: "We have noted your exchange request and will follow up shortly.",
  exchange_rejected: "Your exchange request could not be approved.",
  exchange_approved: "Your exchange request has been approved.",
  scrap_requested: "We have noted your scrap request and will follow up shortly.",
  scrap_rejected: "Your scrap request could not be approved.",
  scrap_approved: "Your scrap request has been approved.",
  return_requested: "Please visit to collect your TV at your convenience.",
  returned_unrepaired: "Your TV has been returned to you unrepaired.",
};

/* Builds the templated WhatsApp message for a reminder. Stage 1 = initial
   diagnosis prompt (fired soon after intake); stage "daily" = the once-a-day
   check-in that replaces 2-hour reminders while a spare part is on order;
   stage 2+ = a detailed section-wise status update. `statusKey` is the
   actual job status (e.g. "in_repair", "waiting_for_spares") — `reason`/
   `customReason` apply when it's "in_repair"; `days` applies when it's
   "waiting_for_spares". */
function buildReminderMessage(reminder, statusKey, days, reason, customReason) {
  const subText = reminder.subFaults && reminder.subFaults.length ? ` (${reminder.subFaults.join(", ")})` : "";
  if (reminder.stage === 1) {
    return `Hello, your TV (Job #${reminder.jobId}) has been inspected. Identified issue: ${reminder.fault}${subText}. We will update you shortly on progress.`;
  }
  if (reminder.stage === "daily") {
    const remaining = reminder.spareWaitUntil ? Math.max(1, Math.ceil((reminder.spareWaitUntil - Date.now()) / (24 * H))) : null;
    return `Hello! Daily update on your TV (Job #${reminder.jobId}): the spare part is still on order${remaining ? ` — approximately ${remaining} more day${remaining > 1 ? "s" : ""}` : ""}. Thank you for your patience.`;
  }
  const issues = reminder.subFaults && reminder.subFaults.length ? reminder.subFaults.join(", ") : reminder.fault;
  let closing = STATUS_CLOSING_NOTE[statusKey] || `We will keep you posted regarding: ${STATUS_META[statusKey]?.label || statusKey}.`;
  if (statusKey === "waiting_for_spares" && days) {
    closing = `We have ordered the required spare part. Please wait ${days} day${days > 1 ? "s" : ""} — we will update you once it arrives.`;
  } else if (statusKey === "in_repair" && reason) {
    closing = `${[reason, (customReason || "").trim()].filter(Boolean).join(" — ")}.`;
  }
  return `Hello! Status update for TV Job #${reminder.jobId}: Main Category: ${reminder.fault}. Identified Issues: ${issues}. ${closing}`;
}

/* Admin-configurable notification sound — one shared preset used by every
   reminder/notification engine in the app (2-hour customer reminder,
   1-hour technician reminder, 30-min unassigned/pre-visit reminders, and
   the "quiet mode" cue while the Add Job screen is open). Fails silently
   if the browser blocks audio (e.g. autoplay policy) rather than
   throwing — a missed sound shouldn't stop a reminder from firing.
   `customUrl` is only used when type === "custom" — a data: URL from an
   Admin-uploaded audio file, played back directly instead of a
   synthesized tone. */
function playConfiguredSound(type, customUrl) {
  if (!type || type === "silent") return;
  if (type === "custom") {
    if (!customUrl) return;
    try {
      const audio = new Audio(customUrl);
      audio.volume = 0.85;
      audio.play().catch(() => {});
    } catch (e) {
      // Playback unavailable — stays silent rather than erroring.
    }
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    if (type === "beep") {
      // Sharp triple beep.
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1046.5, t0 + offset);
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(1, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.24);
      });
      setTimeout(() => ctx.close(), 1400);
    } else if (type === "alert") {
      // Urgent double buzz.
      [0, 0.18].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1200, t0 + offset);
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.17);
      });
      setTimeout(() => ctx.close(), 600);
    } else {
      // "chime" (default) — soft two-tone.
      [880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = t0 + i * 0.14;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      });
      setTimeout(() => ctx.close(), 600);
    }
  } catch (e) {
    // Audio unavailable — notification stays silent rather than erroring.
  }
}

/* Looks up and plays the sound configured for one specific notification
   type (see NOTIFICATION_TYPE_META) — falls back to the chime default if
   that type hasn't been configured yet. */
function playNotificationTypeSound(notificationSettings, typeKey) {
  const cfg = (notificationSettings.sounds && notificationSettings.sounds[typeKey]) || DEFAULT_NOTIFICATION_SOUND_CONFIG;
  playConfiguredSound(cfg.sound, cfg.customSoundUrl);
}

/* Builds a wa.me deep link with a pre-filled message. Indian 10-digit
   numbers get the +91 country code prefixed automatically. */
function waLink(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

/* Builds a tel: link for a one-tap call — works on any mobile browser or
   PWA by handing off to the device's native dialer. */
function telLink(phone) {
  return `tel:${String(phone || "").replace(/\D/g, "")}`;
}

/* Fire a native browser/OS notification if permission has been granted.
   Safe no-op in environments without the Notification API (e.g. some
   in-app WebViews) or if the user hasn't granted permission yet. */
function fireBrowserNotification(title, body, tag) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      const n = new Notification(title, { body, tag, renotify: true });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch {
    /* ignore — notification failures shouldn't break the app */
  }
}

/* ---------------------------------------------------------------------- */
/*  PHOTO CAPTURE — fault photo at intake, "TV ready" photo at delivery.   */
/*  Every image is downscaled + re-encoded as a low-quality JPEG on a     */
/*  canvas before it's stored, so a 4-8MB phone-camera shot typically      */
/*  ends up well under 150KB as a data URL — max auto-compression, no     */
/*  extra libraries, works fully offline.                                  */
/* ---------------------------------------------------------------------- */
function compressImage(file, { maxDim = 900, quality = 0.55 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the selected image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height >= width && height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Reusable tap-to-capture / tap-to-upload photo field. Shows a compact
   thumbnail once a photo is attached, with a one-tap remove (X). Used
   for "Fault Photo" at intake and "TV Ready Photo" at delivery. */
function PhotoUploadField({ label, value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await compressImage(file);
      onChange(dataUrl);
    } catch {
      setError("Couldn't process that photo — please try another.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <img src={value} alt={label} style={{ width: 110, height: 82, objectFit: "cover", borderRadius: 9, border: `1px solid ${COLORS.border}`, display: "block" }} />
            <button
              type="button"
              onClick={() => onChange(null)}
              style={{ position: "absolute", top: -7, right: -7, background: COLORS.red, border: "none", borderRadius: 999, width: 20, height: 20, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={12} />
            </button>
          </div>
          <Btn size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <Camera size={13} /> Replace
          </Btn>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px 14px",
            borderRadius: 10, background: COLORS.panel2, border: `1.5px dashed ${COLORS.border}`,
            color: COLORS.muted, cursor: busy ? "wait" : "pointer", fontSize: 12.5, width: "100%",
          }}
        >
          {busy ? <RefreshCw size={16} color={COLORS.amber} className="spin" /> : <Camera size={16} color={COLORS.amber} />}
          {busy ? "Compressing photo…" : `Tap to capture / upload ${label.toLowerCase()}`}
        </button>
      )}
      {error && <div style={{ fontSize: 11, color: COLORS.red, marginTop: 6 }}>{error}</div>}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
    </div>
  );
}

const SEED_TECHS = []; // demo data removed — real records now come from Firestore

const SEED_PARTS = []; // demo data removed — real records now come from Firestore

const SEED_JOBS = []; // demo data removed — real records now come from Firestore

/* ---------------------------------------------------------------------- */
/*  CUSTOMERS (CID layer) — every inbound enquiry/call becomes a customer  */
/*  record before it's ever a job. A CID with no linked job is a live      */
/*  enquiry/lead; converting it via "+ Create Job" issues a JID and links  */
/*  the two records, mirroring the Customers/Jobs schema from the Android  */
/*  Call Launcher architecture doc.                                        */
/* ---------------------------------------------------------------------- */
const SEED_CUSTOMERS = []; // demo data removed — real records now come from Firestore

/* ---------------------------------------------------------------------- */
/*  ATTENDANCE — mandatory clock-in/out for Front Desk, Indoor, and        */
/*  Outdoor Technicians (Admin is exempt, same as the rest of the app's    */
/*  role restrictions). Each record captures a one-time GPS snapshot at    */
/*  clock-in and clock-out via the browser's Geolocation API — this is     */
/*  NOT continuous tracking (browsers can't do that in the background);    */
/*  it's a location checkpoint at the start and end of the shift.          */
/* ---------------------------------------------------------------------- */
const SEED_ATTENDANCE = []; // demo data removed — real records now come from Firestore

/* Wraps the browser Geolocation API in a promise; resolves to null
   (rather than rejecting) if permission is denied or unavailable, so a
   clock-in/out can still proceed without a location fix. */
function getGeoSnapshot() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
function mapsLink(loc) {
  return loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
}

/* Extracts a {lat, lng} pair out of a pasted location link or plain text —
   handles the common Google Maps URL shapes WhatsApp's "Send current
   location" produces (?q=lat,lng, /@lat,lng,zoom, or just "lat, lng"
   typed/pasted directly). Returns null if no coordinate pair is found. */
function parseLatLngFromText(text) {
  if (!text) return null;
  const match = String(text).match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/* Straight-line distance in km between two {lat,lng} points (Haversine
   formula) — used to flag which outdoor technician is geographically
   nearest a customer, comparing the customer's captured GPS location
   against each technician's most recent clock-in location. Returns null
   if either point is missing. */
function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Formats a 24-hour clock hour as a 12-hour AM/PM label with no minutes —
   e.g. 9 -> "9 AM", 12 -> "12 PM", 13 -> "1 PM". */
function formatHourLabel(h24) {
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${period}`;
}

/* Business hours the service center offers field visits in — 9 AM to
   8 PM, one technician slot per clock hour. */
const VISIT_HOURS_START = 9;
const VISIT_HOURS_END = 20;

function buildHourlyVisitSlots(dayLabel) {
  const slots = [];
  for (let h = VISIT_HOURS_START; h < VISIT_HOURS_END; h++) {
    slots.push(`${dayLabel} (${formatHourLabel(h)}–${formatHourLabel(h + 1)})`);
  }
  return slots;
}

/* Preset slots offered as "estimated visit time" when Admin/Front Desk
   schedules an outdoor technician's field visit — one-hour windows, e.g.
   picking 12 o'clock gives "Today (12 PM–1 PM)". */
const VISIT_TIME_OPTIONS = [
  "ASAP (within 1 hour)",
  ...buildHourlyVisitSlots("Today"),
  ...buildHourlyVisitSlots("Tomorrow"),
];

/* AitechLab's service center location link — included in the outdoor
   field-visit confirmation SMS so the customer has it on hand (e.g. in
   case they'd rather drop the TV off, or want to find the office). */
const SERVICE_CENTER_LOCATION_URL = "https://share.google/mcEgVjD0gpyLw8ErS";

/* Converts a VISIT_TIME_OPTIONS label back into a real timestamp for the
   start of that hour, so the 30-minute pre-visit reminder engine has an
   actual clock time to count down to. "ASAP" has no fixed slot (the
   technician heads over right away, no advance reminder needed), so it
   returns null. */
function parseVisitTimeToTimestamp(label) {
  if (!label || label.startsWith("ASAP")) return null;
  const dayOffset = label.startsWith("Tomorrow") ? 1 : 0;
  const match = label.match(/\((\d{1,2}) (AM|PM)–/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const period = match[2];
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

const SEED_INVOICES = []; // demo data removed — real records now come from Firestore

/* ---------------------------------------------------------------------- */
/*  HELPERS                                                                */
/* ---------------------------------------------------------------------- */
const fmtMoney = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* Formats a 10-digit Indian mobile number as "98432 11001" for readability
   on printed labels/invoices. Leaves non-standard-length numbers untouched. */
const fmtPhone = (p) => {
  const digits = String(p || "").replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return p || "";
};

const timeAgo = (ts, _tick) => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const isSameDay = (ts, ref = Date.now()) => {
  const a = new Date(ts), b = new Date(ref);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

/* Calendar-based range helpers for the technician work report (This Week
   = Monday–Sunday, This Month = 1st–last day) — kept separate from the
   "rolling last N hours" logic used for overdue/reminder checks above. */
function startOfWeek(d = new Date()) {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function endOfWeek(d = new Date()) {
  const end = startOfWeek(d);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function endOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }

/* Triggers a browser download of a CSV built from rows (array of arrays).
   Values are comma/quote-escaped per the usual CSV rules. */
function downloadCsv(filename, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------- */
/*  ACCESS WINDOW — Indoor/Outdoor Technicians can only log in (and stay   */
/*  logged in) during a daily time window that Admin sets per role in      */
/*  Settings → Login Time Settings. Defaults to 09:00–20:00 for both       */
/*  roles until Admin changes them. Any active technician session is       */
/*  force-logged-out the instant the clock passes their role's end time,   */
/*  and logging back in is blocked until the next start time. This is      */
/*  app-level only (the person keeps full use of their phone otherwise) —  */
/*  a true device-wide lock would need the kiosk/MDM setup discussed       */
/*  earlier. Admin and Front Desk are never subject to this window.        */
/* ---------------------------------------------------------------------- */
const DEFAULT_LOGIN_WINDOW_SETTINGS = {
  indoor_tech: { start: "09:00", end: "20:00" },
  outdoor_tech: { start: "09:00", end: "20:00" },
};
function parseHHMM(str) {
  const [h, m] = String(str || "09:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}
/* Handles a same-day window (e.g. 09:00–20:00) as well as an overnight
   one (e.g. 22:00–06:00) so Admin can configure either kind. */
function isWithinLoginWindow(windowCfg, d = new Date()) {
  const startMin = parseHHMM(windowCfg?.start);
  const endMin = parseHHMM(windowCfg?.end);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  if (startMin === endMin) return true; // identical start/end = no restriction
  return startMin < endMin ? (nowMin >= startMin && nowMin < endMin) : (nowMin >= startMin || nowMin < endMin);
}
function fmtHHMMDisplay(str) {
  const [h, m] = String(str || "09:00").split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${period}`;
}

/* ---------------------------------------------------------------------- */
/*  JOB STATUS LIFECYCLE — 15-state workflow (snake_case enum values,      */
/*  human labels for display). STATUS_TRANSITIONS defines which next      */
/*  states are valid from each status — the Update Job / Repair Report    */
/*  dropdowns only ever offer valid transitions, so the UI itself acts    */
/*  as the transition guard (there's no separate backend to validate      */
/*  this against — see the note at the bottom of this file).              */
/* ---------------------------------------------------------------------- */
const STATUS_META = {
  received:             { color: COLORS.blue,  bg: "rgba(46,125,214,0.16)", label: "Received" },
  pending_diagnosis:    { color: COLORS.blue,  bg: "rgba(46,125,214,0.16)", label: "Pending Diagnosis" },
  under_diagnosis:      { color: COLORS.blue,  bg: "rgba(46,125,214,0.16)", label: "Under Diagnosis" },
  fault_identified:     { color: COLORS.blue,  bg: "rgba(46,125,214,0.16)", label: "Fault Identified" },
  awaiting_approval:    { color: COLORS.amber, bg: COLORS.amberDim,        label: "Awaiting Approval" },
  approved_ok:          { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Approved OK" },
  waiting_for_spares:   { color: COLORS.amber, bg: COLORS.amberDim,        label: "Waiting for Spares" },
  in_repair:            { color: COLORS.amber, bg: COLORS.amberDim,        label: "In Repair" },
  ready_for_delivery:   { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Ready for Delivery" },
  not_ready:            { color: COLORS.red,   bg: COLORS.redDim,          label: "Not Ready / Unrepairable" },
  approval_rejected:    { color: COLORS.red,   bg: COLORS.redDim,          label: "Approval Rejected" },
  spares_not_available: { color: COLORS.red,   bg: COLORS.redDim,          label: "Spares Not Available" },
  exchange_requested:   { color: COLORS.amber, bg: COLORS.amberDim,        label: "Exchange Requested" },
  exchange_rejected:    { color: COLORS.red,   bg: COLORS.redDim,          label: "Exchange Rejected" },
  exchange_approved:    { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Exchange Approved" },
  scrap_requested:      { color: COLORS.amber, bg: COLORS.amberDim,        label: "Scrap Requested" },
  scrap_rejected:       { color: COLORS.red,   bg: COLORS.redDim,          label: "Scrap Rejected" },
  scrap_approved:       { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Scrap Approved" },
  return_requested:     { color: COLORS.red,   bg: COLORS.redDim,          label: "Return Requested" },
  delivered:            { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Delivered" },
  returned_unrepaired:  { color: COLORS.red,   bg: COLORS.redDim,          label: "Returned" },
  feedback_pending:     { color: COLORS.blue,  bg: "rgba(46,125,214,0.16)", label: "Feedback OK" },
  others:               { color: COLORS.faint, bg: COLORS.panel2,          label: "Others" },
  closed:               { color: COLORS.teal,  bg: COLORS.tealDim,         label: "Closed" },
};
const STATUS_ORDER = Object.keys(STATUS_META);
const DEFAULT_STATUS = "received";

/* Flat status list shown in the Update Job "Status" dropdown — picking
   "Others" reveals the OTHER_SUB_STATUS_OPTIONS dropdown below it, and the
   sub-status (not "others" itself) is what actually gets saved to the job. */
const MAIN_STATUS_OPTIONS = [
  "received", "pending_diagnosis", "under_diagnosis", "fault_identified",
  "awaiting_approval", "approved_ok", "waiting_for_spares", "in_repair",
  "ready_for_delivery", "delivered", "feedback_pending", "closed", "others",
];
const OTHER_SUB_STATUS_OPTIONS = [
  "not_ready", "spares_not_available", "approval_rejected", "exchange_requested",
  "exchange_rejected", "scrap_requested", "scrap_rejected", "exchange_approved",
  "scrap_approved", "return_requested", "returned_unrepaired", "closed",
];

/* Same flat status list used by the 2-hour reminder's "Current Status to
   Send" dropdown — every entry in MAIN_STATUS_OPTIONS, labelled from
   STATUS_META. Picking "Others" here reveals the same OTHER_SUB_STATUS_OPTIONS
   sub-list as the Update Job form. */
const REMINDER_STATUS_OPTIONS = MAIN_STATUS_OPTIONS.map((key) => ({ label: STATUS_META[key].label, jobStatus: key }));

/* Valid next-states from each status. An empty array means terminal. */
const STATUS_TRANSITIONS = {
  received:            ["pending_diagnosis"],
  pending_diagnosis:   ["under_diagnosis"],
  under_diagnosis:     ["fault_identified", "not_ready"],
  fault_identified:    ["awaiting_approval", "not_ready"],
  awaiting_approval:   ["waiting_for_spares", "in_repair", "approval_rejected"],
  waiting_for_spares:  ["in_repair"],
  in_repair:           ["ready_for_delivery", "not_ready"],
  ready_for_delivery:  ["delivered"],
  not_ready:           ["return_requested"],
  approval_rejected:   ["return_requested"],
  return_requested:    ["returned_unrepaired"],
  delivered:           ["feedback_pending"],
  returned_unrepaired: ["feedback_pending"],
  feedback_pending:    ["closed"],
  closed:              [],
};
function nextStatusOptions(current) {
  const opts = STATUS_TRANSITIONS[current] || [];
  // Always allow staying on the current status (re-saving without changing it).
  return [current, ...opts.filter((s) => s !== current)];
}

/* Status groupings used across reminders, overdue detection, billing, and
   dashboards — replaces the old 4-value Pending/In Progress/Completed/
   Delivered checks scattered through the app. */
const ACTIVE_JOB_STATUSES = [
  "received", "pending_diagnosis", "under_diagnosis", "fault_identified",
  "awaiting_approval", "waiting_for_spares", "in_repair",
];
const REMINDER_STOP_STATUSES = [
  "ready_for_delivery", "delivered", "not_ready", "approval_rejected",
  "return_requested", "returned_unrepaired", "feedback_pending", "closed",
];
const INVOICEABLE_STATUSES = ["ready_for_delivery", "returned_unrepaired"];
const DELIVERY_STATUSES = ["delivered", "returned_unrepaired"]; // require a hand-off photo
const CLOSABLE_STATUSES = ["delivered", "returned_unrepaired", "feedback_pending"];
/* Jobs stuck on a spares issue are the ones eligible for the "Give
   Standby TV" action — a customer waiting on a part is exactly the case
   a loaner TV covers. */
const STANDBY_ELIGIBLE_STATUSES = ["waiting_for_spares", "spares_not_available"];

const PAY_ICON = { Cash: Banknote, GPay: Smartphone, "Credit Card": CreditCard };

/* Pending orders surface first everywhere; within a status, the longest-waiting job leads. */
const STATUS_PRIORITY = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));
const sortByUrgency = (list) =>
  [...list].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.intake - b.intake;
  });

let invCounter = 5002;
const nextInvId = () => `INV-${invCounter++}`;

/* ---------------------------------------------------------------------- */
/*  CID / JID GENERATOR — daily-sequenced IDs, e.g. CID-260816-001,        */
/*  JID-260816-8000. Mirrors the next_daily_id() Postgres function from    */
/*  the Android Call Launcher architecture doc, so the same ID scheme      */
/*  works whether a record originates from the phone app or this web app. */
/*  Job numbers start at 8000 each day; CID numbers start at 001.          */
/* ---------------------------------------------------------------------- */
const dailyIdCounters = {};
const DAILY_ID_CONFIG = {
  JID: { start: 8000, pad: 0 },
  JOD: { start: 8000, pad: 0 },
  CID: { start: 1, pad: 3 },
  COD: { start: 1, pad: 3 },
};
function todayYYYYMMDD() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
function nextDailyId(prefix) {
  const cfg = DAILY_ID_CONFIG[prefix] || { start: 1, pad: 3 };
  const key = `${prefix}-${todayYYYYMMDD()}`;
  if (dailyIdCounters[key] === undefined) dailyIdCounters[key] = cfg.start - 1;
  dailyIdCounters[key] += 1;
  const numStr = cfg.pad ? String(dailyIdCounters[key]).padStart(cfg.pad, "0") : String(dailyIdCounters[key]);
  return `${key}-${numStr}`;
}

/* Reads the live, Admin-editable label-print delay (in ms) for a given
   service type out of notificationSettings.labelPrint, falling back to
   the 30/60-minute defaults if Admin hasn't set anything. */
function labelPrintDelayMs(notificationSettings, jobType) {
  const s = notificationSettings.labelPrint || {};
  const min = jobType === "outdoor" ? (s.outdoorDelayMin || 60) : (s.indoorDelayMin || 30);
  return min * 60 * 1000;
}
function labelPrintSnoozeMs(notificationSettings) {
  const s = notificationSettings.labelPrint || {};
  return (s.snoozeMin || 10) * 60 * 1000;
}
/* Admin-editable "remind me later" delay for the Standby TV reminder —
   see notificationSettings.standbyTv (Settings → Notification Settings →
   Standby TV Return Reminder). */
function standbyTvSnoozeMs(notificationSettings) {
  const s = notificationSettings.standbyTv || {};
  return (s.snoozeMin || 60) * 60 * 1000;
}

/* ---------------------------------------------------------------------- */
/*  SMALL UI PRIMITIVES                                                    */
/* ---------------------------------------------------------------------- */
function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META[DEFAULT_STATUS];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 10px", borderRadius: 999, fontSize: 11.5,
        fontFamily: FONT_MONO, letterSpacing: 0.4, textTransform: "uppercase",
        color: m.color, background: m.bg, border: `1px solid ${m.color}44`,
        fontWeight: 600,
      }}
    >
      <CircleDot size={10} style={{ opacity: 0.9 }} />
      {m.label}
    </span>
  );
}

function Panel({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: COLORS.glass, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        border: `1px solid ${COLORS.glassBorder}`, borderRadius: 10,
        boxShadow: `inset 0 1px 0 ${COLORS.glassHighlight}, 0 4px 18px rgba(0,0,0,0.22)`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "default", size = "md", style, disabled, type = "button", ...rest }) {
  const base = {
    fontFamily: FONT_SANS, fontWeight: 600, borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    border: "1px solid transparent", transition: "filter 0.12s ease, transform 0.05s ease",
    opacity: disabled ? 0.5 : 1,
  };
  const sizes = {
    sm: { padding: "6px 11px", fontSize: 12.5 },
    md: { padding: "9px 15px", fontSize: 13.5 },
    lg: { padding: "12px 20px", fontSize: 14.5 },
  };
  const variants = {
    default: { background: COLORS.amber, color: "#1A1300", border: `1px solid ${COLORS.amber}` },
    outline: { background: "transparent", color: COLORS.text, border: `1px solid ${COLORS.borderLight}` },
    ghost: { background: "transparent", color: COLORS.muted, border: "1px solid transparent" },
    teal: { background: COLORS.teal, color: "#00251F", border: `1px solid ${COLORS.teal}` },
    danger: { background: "transparent", color: COLORS.red, border: `1px solid ${COLORS.red}55` },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.98)"; }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = "brightness(1.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "brightness(1)")}
      {...rest}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.55)", border: `1px solid ${COLORS.glassBorder}`, borderRadius: 7,
  padding: "9px 11px", color: COLORS.text, fontSize: 13.5, fontFamily: FONT_SANS, outline: "none",
  width: "100%", boxSizing: "border-box",
};

function Input(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function TextArea(props) {
  return <textarea {...props} style={{ ...inputStyle, resize: "vertical", minHeight: 64, ...(props.style || {}) }} />;
}
function Select({ children, ...props }) {
  return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>{children}</select>;
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(6,8,11,0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto",
          background: COLORS.glass2, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12,
          boxShadow: `inset 0 1px 0 ${COLORS.glassHighlight}, 0 20px 60px rgba(0,0,0,0.5)`,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: `1px solid ${COLORS.glassBorder}`, position: "sticky", top: 0,
          background: COLORS.glass2, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: "12px 12px 0 0",
        }}>
          <h3 style={{ margin: 0, fontSize: 15.5, color: COLORS.text, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.muted, cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent, onClick }) {
  return (
    <Panel
      style={{ padding: 18, flex: 1, minWidth: 190, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      onMouseEnter={onClick ? (e) => (e.currentTarget.style.borderColor = accent) : undefined}
      onMouseLeave={onClick ? (e) => (e.currentTarget.style.borderColor = COLORS.glassBorder) : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${accent}1c`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={accent} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontFamily: FONT_MONO, fontWeight: 700, color: COLORS.text }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 4 }}>{sub}</div>}
    </Panel>
  );
}

/* ---------------------------------------------------------------------- */
/*  MOBILE / BROWSER BACK-BUTTON HANDLING — makes the hardware or browser  */
/*  back button step back through in-app screens (modals, detail panels,  */
/*  print views, tab navigation) instead of exiting the whole app. Every  */
/*  open overlay pushes one browser history entry onto a shared LIFO      */
/*  stack; a single global popstate listener pops the most recently       */
/*  opened one and closes it. Once the stack is empty, the next back      */
/*  press falls through to whatever the browser/webview normally does     */
/*  (e.g. actually exiting) — exactly one screen closes per back press.   */
/* ---------------------------------------------------------------------- */
const navBackStack = []; // LIFO of { id, close }
let suppressNextPopState = false;
let popStateListenerAttached = false;

function ensurePopStateListener() {
  if (popStateListenerAttached || typeof window === "undefined") return;
  popStateListenerAttached = true;
  window.addEventListener("popstate", () => {
    if (suppressNextPopState) { suppressNextPopState = false; return; }
    const top = navBackStack.pop();
    if (top) top.close();
  });
}
function pushNavBack(id, close) {
  ensurePopStateListener();
  navBackStack.push({ id, close });
  if (typeof window !== "undefined") window.history.pushState({ __nav: id }, "");
}
function popNavBack(id) {
  const idx = navBackStack.map((x) => x.id).lastIndexOf(id);
  if (idx === -1) return;
  navBackStack.splice(idx, 1);
  if (typeof window !== "undefined") {
    suppressNextPopState = true;
    window.history.back();
  }
}
/* Reusable anywhere in the component tree: give it a stable id (unique
   among whatever else might be open at the same time), whether the
   thing is currently open, and how to close it. Opening pushes a
   history entry; closing — by an X/Cancel button, by selecting
   something, or by the back button itself — consumes exactly that one
   entry, so history never accumulates stale steps. */
function useBackClose(id, isOpen, close) {
  const wasOpenRef = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      pushNavBack(id, () => closeRef.current());
    } else if (!isOpen && wasOpenRef.current) {
      popNavBack(id);
    }
    wasOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, id]);
  // If the component unmounts while still open (e.g. role switched away
  // mid-modal), silently drop its entry so the stack doesn't get stuck.
  useEffect(() => () => { if (wasOpenRef.current) popNavBack(id); }, [id]);
}

/* ---------------------------------------------------------------------- */
/*  ROOT APP                                                               */
/* ---------------------------------------------------------------------- */
export default function AitechLabCRM() {
  const [role, setRole] = useState(null); // 'admin' | 'frontdesk' | 'technician'
  const [activeTechId, setActiveTechId] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newJobScreenOpenedAt, setNewJobScreenOpenedAt] = useState(null); // when the Add Job screen was opened — popups stay quiet (sound only) for 2 min after this, or until the screen is left

  const [technicians, setTechnicians] = useFirestoreArrayState("technicians", "id");
  const [parts, setParts] = useFirestoreArrayState("parts", "id");
  const [jobs, setJobs] = useFirestoreArrayState("jobs", "id", "intake");
  const [customers, setCustomers] = useFirestoreArrayState("customers", "customerId", "createdAt");
  const [invoices, setInvoices] = useFirestoreArrayState("invoices", "id", "createdAt");
  const [smsLog, appendSmsLog] = useFirestoreLogState("smsLog", "ts");

  const [tick, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(null);
  const [confirmDeleteTech, setConfirmDeleteTech] = useState(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(null);
  const [reminders, setReminders] = useState([]); // active 2-hour reminders awaiting technician action
  const [newJobPreset, setNewJobPreset] = useState(null); // CID being converted into a job via "+ Create Job"
  const [addingCustomer, setAddingCustomer] = useState(false); // global "+ Add New Customer" modal, reachable from every dashboard
  const [popupReminder, setPopupReminder] = useState(null); // reminder shown as an auto-opened modal
  const [confirmedRepairPopup, setConfirmedRepairPopup] = useState(null); // "customer confirmed" notification for the technician
  const [declinedRepairPopup, setDeclinedRepairPopup] = useState(null); // "customer declined — return TV" notification for the technician
  const [repairRequestQueue, setRepairRequestQueue] = useState([]); // jobs awaiting Admin/Front Desk review, shown one at a time
  const [activeRepairRequestPopup, setActiveRepairRequestPopup] = useState(null); // the one currently blocking the screen
  const notifiedRepairRequestsRef = useRef(new Set()); // job IDs already queued, so they don't re-pop on every render
  const [reassignmentQueue, setReassignmentQueue] = useState([]); // jobs a technician handed back, awaiting Admin/Front Desk reassignment
  const [activeReassignmentPopup, setActiveReassignmentPopup] = useState(null); // the one currently blocking the screen
  const notifiedReassignmentRef = useRef(new Set()); // job IDs already queued for reassignment, so they don't re-pop
  const [techUpdateRequestPopup, setTechUpdateRequestPopup] = useState(null); // "Admin/Front Desk wants a status update" — blocking modal for the assigned technician
  const [techUpdateFeedbackQueue, setTechUpdateFeedbackQueue] = useState([]); // technician responses awaiting Admin/Front Desk review, shown one at a time
  const [activeTechUpdateFeedback, setActiveTechUpdateFeedback] = useState(null); // the one currently blocking the screen
  const notifiedTechUpdateRef = useRef(new Set()); // job IDs already queued for review, so they don't re-pop
  const [techReminders, setTechReminders] = useState([]); // 1-hour "check this job" nudges for Indoor/Outdoor Technicians
  const [techReminderPopup, setTechReminderPopup] = useState(null); // most recent one, auto-opened as a blocking modal
  const [attendance, setAttendance] = useFirestoreArrayState("attendance", "id", "clockIn"); // clock-in/out log — see the ATTENDANCE section below
  const [liveLocations, setLiveLocations] = useState({}); // { [techId]: {lat, lng, accuracy, ts} } — continuous GPS while a technician session is on shift, see the live-tracking effect below
  const [clockingIn, setClockingIn] = useState(false); // spinner while requesting geolocation on Clock In/Out
  const [jobPromptCustomer, setJobPromptCustomer] = useState(null); // "Create Job ID now?" prompt after saving a new customer
  const [assigningOutdoorFor, setAssigningOutdoorFor] = useState(null); // customer record — "Assign Outdoor Technician" form is open for this customer
  const [outdoorVisitRequestPopup, setOutdoorVisitRequestPopup] = useState(null); // pending field-visit assignment awaiting this technician's Accept/Decline
  const [upcomingVisitPopup, setUpcomingVisitPopup] = useState(null); // "your visit is in 30 min" — technician-side
  const [techFollowupPopup, setTechFollowupPopup] = useState(null); // "check in with the technician" — Admin/Front Desk-side
  const [postCreateJobPopup, setPostCreateJobPopup] = useState(null); // "Job Card Created" prompt — print label / assign tech / assign later
  const [unassignedReminderPopup, setUnassignedReminderPopup] = useState(null); // recurring 30-min "still unassigned" nudge for Admin/Front Desk
  const [labelPrintReminderQueue, setLabelPrintReminderQueue] = useState([]); // jobs awaiting a "label not printed" nudge, oldest first
  const [labelPrintReminderPopup, setLabelPrintReminderPopup] = useState(null); // the one currently blocking the screen
  const [standbyLoans, setStandbyLoans] = useFirestoreArrayState("standbyLoans", "id", "givenAt"); // active/returned standby-TV loan records, newest first — see "STANDBY TV" section below
  const [givingStandbyFor, setGivingStandbyFor] = useState(null); // job the "Give Standby TV" form is currently open for
  const [standbyTvReminderQueue, setStandbyTvReminderQueue] = useState([]); // loans whose agreed days are up, awaiting a "collect it back" nudge
  const [standbyTvReminderPopup, setStandbyTvReminderPopup] = useState(null); // the one currently blocking the screen
  const [incomingCallPhone, setIncomingCallPhone] = useState(null); // number "detected" by the call-ID popup
  const [simulatingCall, setSimulatingCall] = useState(false); // the manual phone-entry prompt that stands in for real call detection
  const [smsDispatchMode, setSmsDispatchMode] = useFirestoreValueState("settings", "smsDispatch", "automatic"); // Admin toggle: "automatic" | "manual"
  const [notificationSettings, setNotificationSettings] = useFirestoreValueState("settings", "notifications", DEFAULT_NOTIFICATION_SETTINGS); // Admin toggle: per-role on/off, reminder delay, and shared sound preset
  const [loginWindowSettings, setLoginWindowSettings] = useFirestoreValueState("settings", "loginWindow", DEFAULT_LOGIN_WINDOW_SETTINGS); // Admin toggle: daily login start/end time, per technician role
  const [extraTasks, setExtraTasks] = useFirestoreArrayState("extraTasks", "id", "createdAt"); // ad-hoc work Admin/Front Desk hands a technician outside of job cards — e.g. "restock parts bin", "clean bench 2"

  const toastTimer = useRef(null);
  const prevOverdueCount = useRef(null);
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  /* live "time ago" ticker */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  /* Marks when the Add Job screen opens/closes — drives the "quiet mode"
     below: notification popups hold off (sound only) while this screen is
     open, so a job intake in progress never gets interrupted by a modal
     stealing focus mid-form. */
  useEffect(() => {
    setNewJobScreenOpenedAt(tab === "newjob" ? Date.now() : null);
  }, [tab]);

  const holdPopupsForNewJob = tab === "newjob" && !!newJobScreenOpenedAt && (Date.now() - newJobScreenOpenedAt < 2 * 60 * 1000);

  /* True the instant ANY blocking notification is queued up, regardless
     of source — used only to decide whether to play the quiet-mode sound
     cue below while popups are being held back. */
  const anyPopupPending = !!(
    postCreateJobPopup || techUpdateRequestPopup || activeTechUpdateFeedback ||
    activeReassignmentPopup || outdoorVisitRequestPopup || upcomingVisitPopup ||
    techFollowupPopup || unassignedReminderPopup || techReminderPopup ||
    popupReminder || confirmedRepairPopup || declinedRepairPopup ||
    activeRepairRequestPopup || jobPromptCustomer || labelPrintReminderPopup ||
    standbyTvReminderPopup
  );

  const heldNotificationSoundRef = useRef(false);
  useEffect(() => {
    const isHeld = holdPopupsForNewJob && anyPopupPending;
    if (isHeld && !heldNotificationSoundRef.current) {
      playNotificationTypeSound(notificationSettings, "quietModeCue");
    }
    heldNotificationSoundRef.current = isHeld;
  }, [holdPopupsForNewJob, anyPopupPending, notificationSettings]);

  /* Closes whichever blocking popup is currently on screen, in the same
     precedence order as anyPopupPending above — used by the back-button
     handling below so one back press dismisses one popup at a time. */
  function closeTopPopup() {
    if (postCreateJobPopup) return setPostCreateJobPopup(null);
    if (techUpdateRequestPopup) return setTechUpdateRequestPopup(null);
    if (activeTechUpdateFeedback) return setActiveTechUpdateFeedback(null);
    if (activeReassignmentPopup) return setActiveReassignmentPopup(null);
    if (outdoorVisitRequestPopup) return setOutdoorVisitRequestPopup(null);
    if (upcomingVisitPopup) return setUpcomingVisitPopup(null);
    if (techFollowupPopup) return setTechFollowupPopup(null);
    if (unassignedReminderPopup) return setUnassignedReminderPopup(null);
    if (techReminderPopup) return setTechReminderPopup(null);
    if (popupReminder) return setPopupReminder(null);
    if (confirmedRepairPopup) return setConfirmedRepairPopup(null);
    if (declinedRepairPopup) return setDeclinedRepairPopup(null);
    if (activeRepairRequestPopup) return setActiveRepairRequestPopup(null);
    if (jobPromptCustomer) return setJobPromptCustomer(null);
    if (labelPrintReminderPopup) return setLabelPrintReminderPopup(null);
    if (standbyTvReminderPopup) return setStandbyTvReminderPopup(null);
  }

  /* --------------------------------------------------------------- */
  /*  BACK-BUTTON HANDLING (mobile/browser) — every full-screen print   */
  /*  view, confirm dialog, and blocking popup below registers with     */
  /*  useBackClose so the hardware/browser back button closes just that */
  /*  one thing instead of exiting the app. Tab navigation gets its own */
  /*  history-backed stack right after, so back also steps to whatever  */
  /*  tab was open before, not straight out to the login screen.        */
  /* --------------------------------------------------------------- */
  useBackClose("printJob", !!printJob, () => setPrintJob(null));
  useBackClose("printInvoice", !!printInvoice, () => setPrintInvoice(null));
  useBackClose("addingCustomer", addingCustomer, () => setAddingCustomer(false));
  useBackClose("confirmDeleteJob", !!confirmDeleteJob, () => setConfirmDeleteJob(null));
  useBackClose("confirmDeleteTech", !!confirmDeleteTech, () => setConfirmDeleteTech(null));
  useBackClose("confirmDeleteCustomer", !!confirmDeleteCustomer, () => setConfirmDeleteCustomer(null));
  useBackClose("blockingPopup", anyPopupPending, closeTopPopup);
  useBackClose("givingStandbyFor", !!givingStandbyFor, () => setGivingStandbyFor(null));

  /* Tab navigation history — each time the visible tab changes, push an
     entry whose close() returns to whatever tab was showing before, so
     back walks through recently visited tabs one at a time. The very
     first tab after login/role-select is the base of the stack, so a
     back press there falls through to actually leaving the app. */
  const prevTabRef = useRef(tab);
  const tabHistoryInitRef = useRef(false);
  useEffect(() => {
    if (!tabHistoryInitRef.current) {
      // First run after mount/role-select — establish the baseline
      // without pushing a history entry (nothing to go back to yet).
      tabHistoryInitRef.current = true;
      prevTabRef.current = tab;
      return;
    }
    if (tab !== prevTabRef.current) {
      const returnTo = prevTabRef.current;
      pushNavBack(`tab:${Date.now()}`, () => setTab(returnTo));
      prevTabRef.current = tab;
    }
  }, [tab]);
  // Resets the tab-history baseline on logout/role switch, so the next
  // login starts a fresh stack instead of carrying over stale entries.
  useEffect(() => { if (!role) tabHistoryInitRef.current = false; }, [role]);

  /* Auto-logout the instant a technician's role-specific window ends —
     Indoor/Outdoor Technician sessions only. Admin and Front Desk are
     exempt (they may need to work past the window to close out the day).
     Checked every 30s so it fires within that margin of the end time,
     not just on the next full minute. */
  useEffect(() => {
    const t = setInterval(() => {
      const isTech = role === "indoor_tech" || role === "outdoor_tech";
      if (!isTech) return;
      const cfg = loginWindowSettings[role] || DEFAULT_LOGIN_WINDOW_SETTINGS[role];
      if (!isWithinLoginWindow(cfg)) {
        setRole(null);
        setActiveTechId(null);
        pushToast(`Logged out — ${role === "indoor_tech" ? "Indoor" : "Outdoor"} Technician access is only available between ${fmtHHMMDisplay(cfg.start)} and ${fmtHHMMDisplay(cfg.end)}.`, "alert");
      }
    }, 30 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, loginWindowSettings]);

  /* automated dashboard refresh — polls every 30s; jobs pending/in-progress for
     over 2h are flagged overdue, and a toast fires only when that count changes */
  useEffect(() => {
    const REFRESH_MS = 30 * 1000;
    const OVERDUE_THRESHOLD_MS = 2 * H;
    const t = setInterval(() => {
      setLastRefresh(Date.now());
      const overdue = jobs.filter(
        (j) => ACTIVE_JOB_STATUSES.includes(j.status) && Date.now() - j.intake > OVERDUE_THRESHOLD_MS
      );
      if (prevOverdueCount.current !== null && overdue.length !== prevOverdueCount.current) {
        pushToast(`Auto-refresh: ${overdue.length} order${overdue.length === 1 ? "" : "s"} still pending action.`, "alert");
      }
      prevOverdueCount.current = overdue.length;
    }, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  /* ask for browser/OS notification permission once, up front, so the
     2-hour reminders can actually pop a native alert */
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  AUTOMATED REMINDER ENGINE — 2-hourly by default; switches to a     */
  /*  once-a-day cadence for any job currently in its "Spare Ordered"    */
  /*  wait window (see spareWaitUntil, set from the reminder response    */
  /*  UI). Every REMINDER_POLL_MS we check each job that is NOT          */
  /*  Completed/Delivered. Stage 1 = initial diagnosis prompt; stage     */
  /*  "daily" = once-a-day spare-wait check-in; stage 2+ = status-update */
  /*  prompt. Marking a job Completed/Delivered stops the cycle          */
  /*  immediately; leaving the wait window resets the 2h baseline so no  */
  /*  backlog of "missed" reminders fires all at once.                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const officeSettings = (role === "admin" ? notificationSettings.admin : notificationSettings.frontdesk) || {};
      if (!officeSettings.enabled) return;
      const reminderIntervalMs = (officeSettings.customerReminderMin || 120) * 60 * 1000;
      const currentJobs = jobsRef.current;
      const newReminders = [];
      const updated = currentJobs.map((j) => {
        if (REMINDER_STOP_STATUSES.includes(j.status)) return j;

        // Still inside an active spare-parts wait window — daily cadence.
        if (j.spareWaitUntil && Date.now() < j.spareWaitUntil) {
          const elapsedDailyStages = Math.floor((Date.now() - (j.spareOrderedAt || j.intake)) / (24 * H));
          const sentDaily = j.dailyRemindersSent || 0;
          if (elapsedDailyStages > sentDaily) {
            const nextStage = sentDaily + 1;
            newReminders.push({
              id: `${j.id}-daily${nextStage}`,
              jobId: j.id, stage: "daily", ts: Date.now(), jobStatus: j.status,
              fault: j.fault, subFaults: j.subFaults || [], phone: j.phone,
              customer: j.customer, brand: j.brand, model: j.model,
              spareWaitUntil: j.spareWaitUntil, spareWaitDays: j.spareWaitDays,
              assignedTech: j.assignedTech, jobType: j.jobType,
            });
            return { ...j, dailyRemindersSent: nextStage };
          }
          return j;
        }

        // Wait window just expired — reset the 2h baseline to "now" instead
        // of resuming from intake, so we don't fire a burst of catch-up
        // reminders for the days spent on daily cadence.
        if (j.spareWaitUntil && Date.now() >= j.spareWaitUntil) {
          return { ...j, spareWaitUntil: null, reminderBaseline: Date.now(), remindersSent: 0 };
        }

        const baseline = j.reminderBaseline || j.intake;
        const elapsedStages = Math.floor((Date.now() - baseline) / reminderIntervalMs);
        const sent = j.remindersSent || 0;
        if (elapsedStages > sent) {
          const nextStage = sent + 1;
          newReminders.push({
            id: `${j.id}-r${nextStage}`,
            jobId: j.id, stage: nextStage, ts: Date.now(), jobStatus: j.status,
            fault: j.fault, subFaults: j.subFaults || [], phone: j.phone,
            customer: j.customer, brand: j.brand, model: j.model,
            assignedTech: j.assignedTech, jobType: j.jobType,
          });
          return { ...j, remindersSent: nextStage };
        }
        return j;
      });

      if (newReminders.length) {
        setJobs(updated);
        newReminders.forEach((r) => {
          playNotificationTypeSound(notificationSettings, r.stage === "daily" ? "dailySpareWait" : "customerReminder");
          fireBrowserNotification(
            r.stage === "daily" ? `Job #${r.jobId} — daily spare-wait check-in` : `Job #${r.jobId} — 2-hour check-in`,
            r.stage === "daily"
              ? `Send today's "still on order" update to ${r.customer}?`
              : r.stage === 1
              ? `Send initial fault diagnosis (${r.fault}) to ${r.customer}?`
              : `Update status for Job #${r.jobId} (${r.fault}) and notify ${r.customer}.`,
            r.jobId
          );
        });
        setReminders((rs) => {
          const jobIds = newReminders.map((r) => r.jobId);
          return [...newReminders, ...rs.filter((r) => !jobIds.includes(r.jobId))];
        });
        /* Section-wise detailed pop-up: for a job that's actively In
           Progress, surface a full modal (Job ID + main fault + every
           sub-section checked) instead of making the technician dig
           through the bell menu. Most recent one wins if several fire
           in the same poll. */
        const inProgressReminder = [...newReminders].reverse().find((r) => ACTIVE_JOB_STATUSES.includes(r.jobStatus));
        if (inProgressReminder) setPopupReminder(inProgressReminder);
        const dailyCount = newReminders.filter((r) => r.stage === "daily").length;
        const otherCount = newReminders.length - dailyCount;
        const toastParts = [];
        if (otherCount) toastParts.push(`${otherCount} job${otherCount === 1 ? "" : "s"} due for a 2-hour customer update`);
        if (dailyCount) toastParts.push(`${dailyCount} daily spare-wait check-in${dailyCount === 1 ? "" : "s"}`);
        pushToast(`⏰ ${toastParts.join(" · ")}.`, "alert");
      }
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, notificationSettings]);

  /* auto-stop: the moment a job's status flips to Completed/Delivered
     (from anywhere in the app), drop any reminder card still showing
     for it — no more timers, no more badge count for that Job ID. */
  useEffect(() => {
    setReminders((rs) => rs.filter((r) => {
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && !REMINDER_STOP_STATUSES.includes(j.status);
    }));
    setPopupReminder((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && !REMINDER_STOP_STATUSES.includes(j.status) ? r : null;
    });
  }, [jobs]);

  /* ---------------------------------------------------------------- */
  /*  TECHNICIAN 1-HOUR REMINDER ENGINE — completely separate from the   */
  /*  2-hour customer-update cycle above. Indoor/Outdoor Technicians      */
  /*  never see that one (it's for messaging customers, and techs can't  */
  /*  see customer contact info). Instead, every assigned job that's     */
  /*  still active gets a simple "check this job" nudge once an hour,    */
  /*  using its own counter (techRemindersSent) so it never interferes   */
  /*  with the 2-hour counters used for Admin/Front Desk.                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const techSettings = notificationSettings.indoor_tech || {};
      if (!techSettings.enabled) return;
      const techReminderIntervalMs = (techSettings.reminderMin || 60) * 60 * 1000;
      const currentJobs = jobsRef.current;
      const newTechReminders = [];
      const updated = currentJobs.map((j) => {
        if (!j.assignedTech || !ACTIVE_JOB_STATUSES.includes(j.status)) return j;
        const elapsedStages = Math.floor((Date.now() - j.intake) / techReminderIntervalMs);
        const sent = j.techRemindersSent || 0;
        if (elapsedStages > sent) {
          const nextStage = sent + 1;
          newTechReminders.push({
            id: `${j.id}-tr${nextStage}`,
            jobId: j.id, stage: nextStage, ts: Date.now(),
            assignedTech: j.assignedTech, brand: j.brand, model: j.model, status: j.status,
          });
          return { ...j, techRemindersSent: nextStage };
        }
        return j;
      });

      if (newTechReminders.length) {
        setJobs(updated);
        setTechReminders((rs) => {
          const jobIds = newTechReminders.map((r) => r.jobId);
          return [...newTechReminders, ...rs.filter((r) => !jobIds.includes(r.jobId))];
        });
        // Pop the most recent one for whichever technician is currently
        // logged in and it belongs to — same "surface it, don't make them
        // dig through the bell" idea as the Admin/Front Desk popup.
        if (role === "indoor_tech" || role === "outdoor_tech") {
          const mine = [...newTechReminders].reverse().find((r) => r.assignedTech === activeTechId);
          if (mine) {
            setTechReminderPopup(mine);
            playNotificationTypeSound(notificationSettings, "techReminder");
          }
        }
      }
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeTechId, notificationSettings]);

  useEffect(() => {
    setTechReminders((rs) => rs.filter((r) => {
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && ACTIVE_JOB_STATUSES.includes(j.status);
    }));
    setTechReminderPopup((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && ACTIVE_JOB_STATUSES.includes(j.status) ? r : null;
    });
  }, [jobs]);

  /* ---------------------------------------------------------------- */
  /*  UNASSIGNED-TECHNICIAN 30-MIN REMINDER ENGINE — separate again     */
  /*  from both cycles above. Any job that's still active but has no    */
  /*  technician assigned nudges Admin/Front Desk once every 30 min,    */
  /*  starting from intake, until someone assigns it.                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const officeSettings = (role === "admin" ? notificationSettings.admin : notificationSettings.frontdesk) || {};
      if (!officeSettings.enabled) return;
      const unassignedIntervalMs = (officeSettings.unassignedReminderMin || 30) * 60 * 1000;
      const currentJobs = jobsRef.current;
      const newReminders = [];
      const updated = currentJobs.map((j) => {
        if (j.assignedTech || !ACTIVE_JOB_STATUSES.includes(j.status)) return j;
        const elapsedStages = Math.floor((Date.now() - j.intake) / unassignedIntervalMs);
        const sent = j.unassignedRemindersSent || 0;
        if (elapsedStages > sent) {
          const nextStage = sent + 1;
          newReminders.push({
            id: `${j.id}-ua${nextStage}`,
            jobId: j.id, stage: nextStage, ts: Date.now(),
            customer: j.customer, brand: j.brand, model: j.model, jobType: j.jobType,
          });
          return { ...j, unassignedRemindersSent: nextStage };
        }
        return j;
      });

      if (newReminders.length) {
        setJobs(updated);
        if (role === "admin" || role === "frontdesk") {
          setUnassignedReminderPopup(newReminders[newReminders.length - 1]);
          playNotificationTypeSound(notificationSettings, "unassignedReminder");
        }
      }
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, notificationSettings]);

  useEffect(() => {
    setUnassignedReminderPopup((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && !j.assignedTech && ACTIVE_JOB_STATUSES.includes(j.status) ? r : null;
    });
  }, [jobs]);

  /* ---------------------------------------------------------------- */
  /*  LABEL-PRINT REMINDER ENGINE — this is the "background scheduler/  */
  /*  cron job" for is_label_printed. Every REMINDER_POLL_MS we scan    */
  /*  every job whose nextLabelNotificationAt has passed and which      */
  /*  still has isLabelPrinted === false. A hit gets queued once (we    */
  /*  null out nextLabelNotificationAt the same tick so it isn't        */
  /*  re-added on the next poll), and Admin/Front Desk sees it as a     */
  /*  blocking modal. The three actions below are what re-arm the       */
  /*  timer for the next check — every delay used is read live from     */
  /*  notificationSettings.labelPrint, which Admin edits in Settings →  */
  /*  Notification Settings → Label Print Reminder:                     */
  /*    - Print Label Now  → isLabelPrinted becomes true, timer stops.  */
  /*    - Remind Me Later  → nextLabelNotificationAt = now + snoozeMin. */
  /*    - Dismiss          → nextLabelNotificationAt = now + the same   */
  /*      indoor/outdoor delay it started with, so it keeps nagging     */
  /*      on schedule instead of going silent.                          */
  /*  Stops entirely once isLabelPrinted flips true, the job reaches a  */
  /*  REMINDER_STOP_STATUSES state (delivered, closed, etc.), or Admin  */
  /*  turns the labelPrint toggle off.                                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const labelSettings = notificationSettings.labelPrint || {};
      if (!labelSettings.enabled) return;
      const currentJobs = jobsRef.current;
      const due = currentJobs.filter((j) =>
        !j.isLabelPrinted &&
        !REMINDER_STOP_STATUSES.includes(j.status) &&
        j.nextLabelNotificationAt &&
        Date.now() >= j.nextLabelNotificationAt
      );
      if (!due.length) return;

      // Clear the trigger timestamp immediately so this same due job
      // isn't picked up again on the next poll tick before it's resolved.
      setJobs((js) => js.map((j) => (due.some((d) => d.id === j.id) ? { ...j, nextLabelNotificationAt: null } : j)));

      if (role !== "admin" && role !== "frontdesk") return;
      const additions = due.map((j) => ({
        id: `${j.id}-label${Date.now()}`,
        jobId: j.id, jobType: j.jobType, ts: Date.now(),
        customer: j.customer, brand: j.brand, model: j.model,
      }));
      setLabelPrintReminderQueue((q) => [...q, ...additions]);
      playNotificationTypeSound(notificationSettings, "labelPrintReminder");
      additions.forEach((r) => fireBrowserNotification(
        `Label not printed — Job #${r.jobId}`,
        `${r.brand} ${r.model} for ${r.customer}. Print the job card label now?`,
        `label-${r.jobId}`
      ));
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, notificationSettings]);

  /* Surfaces the oldest pending label-print alert as a blocking popup,
     one at a time — mirrors unassignedReminderPopup above. */
  useEffect(() => {
    if ((role !== "admin" && role !== "frontdesk") || holdPopupsForNewJob) return;
    if (!labelPrintReminderPopup && labelPrintReminderQueue.length) {
      setLabelPrintReminderPopup(labelPrintReminderQueue[0]);
    }
  }, [labelPrintReminderQueue, labelPrintReminderPopup, role, holdPopupsForNewJob]);

  /* Auto-clears the popup/queue entry if the job gets its label printed
     (or closed out) through some other path while the alert is showing. */
  useEffect(() => {
    setLabelPrintReminderQueue((q) => q.filter((r) => {
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && !j.isLabelPrinted && !REMINDER_STOP_STATUSES.includes(j.status);
    }));
  }, [jobs]);
  useEffect(() => {
    setLabelPrintReminderPopup((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && !j.isLabelPrinted && !REMINDER_STOP_STATUSES.includes(j.status) ? r : null;
    });
  }, [jobs]);

  /* Marks is_label_printed = true — called once the print flow actually
     fires (see PrintChrome's onPrinted). Stops the reminder cycle for good. */
  function markLabelPrinted(jobId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, isLabelPrinted: true, labelPrintedAt: Date.now(), nextLabelNotificationAt: null } : j)));
  }

  function printLabelReminderNow(reminder) {
    const job = jobs.find((j) => j.id === reminder.jobId);
    setLabelPrintReminderQueue((q) => q.filter((r) => r.id !== reminder.id));
    setLabelPrintReminderPopup(null);
    if (job) setPrintJob(job);
  }

  function snoozeLabelPrintReminder(reminder) {
    setJobs((js) => js.map((j) => (j.id === reminder.jobId ? { ...j, nextLabelNotificationAt: Date.now() + labelPrintSnoozeMs(notificationSettings) } : j)));
    setLabelPrintReminderQueue((q) => q.filter((r) => r.id !== reminder.id));
    setLabelPrintReminderPopup(null);
    pushToast(`Snoozed — you'll be reminded again in ${(notificationSettings.labelPrint || {}).snoozeMin || 10} minutes for ${reminder.jobId}.`, "alert");
  }

  function dismissLabelPrintReminder(reminder) {
    setJobs((js) => js.map((j) => (j.id === reminder.jobId ? { ...j, nextLabelNotificationAt: Date.now() + labelPrintDelayMs(notificationSettings, reminder.jobType) } : j)));
    setLabelPrintReminderQueue((q) => q.filter((r) => r.id !== reminder.id));
    setLabelPrintReminderPopup(null);
  }

  /* ---------------------------------------------------------------- */
  /*  STANDBY TV — when a job is stuck on Waiting for Spares / Spares    */
  /*  Not Available, Admin/Front Desk can hand the customer a standby   */
  /*  TV against an advance amount, for an agreed number of days.       */
  /*  giveStandbyTv() below records that loan; the reminder engine       */
  /*  further down nags Admin/Front Desk once those days are up so the  */
  /*  standby unit actually gets collected back, not forgotten.         */
  /* ---------------------------------------------------------------- */
  function giveStandbyTv(job, form, by) {
    const days = Math.max(1, Number(form.days) || 1);
    const givenAt = Date.now();
    const dueAt = givenAt + days * 24 * H;
    const loan = {
      id: `STB-${job.id}-${givenAt}`,
      jobId: job.id,
      customer: job.customer,
      customerId: job.customerId || null,
      tvGiven: (form.tvGiven || "").trim(),
      advanceAmount: Math.max(0, Number(form.advanceAmount) || 0),
      days,
      givenAt,
      dueAt,
      nextReminderAt: dueAt,
      returned: false,
      returnedAt: null,
      by,
    };
    setStandbyLoans((s) => [loan, ...s]);
    setGivingStandbyFor(null);
    pushToast(`Standby TV recorded for ${job.id} — due back in ${days} day${days === 1 ? "" : "s"}.`, "ok");
  }

  function markStandbyReturned(loanId) {
    setStandbyLoans((s) => s.map((l) => (l.id === loanId ? { ...l, returned: true, returnedAt: Date.now(), nextReminderAt: null } : l)));
    setStandbyTvReminderQueue((q) => q.filter((r) => r.id !== loanId));
    setStandbyTvReminderPopup((p) => (p && p.id === loanId ? null : p));
    pushToast("Standby TV marked as returned.", "ok");
  }

  /* ---------------------------------------------------------------- */
  /*  STANDBY-TV REMINDER ENGINE — same "cron poll" shape as the        */
  /*  label-print reminder above. Every REMINDER_POLL_MS we scan every  */
  /*  loan whose nextReminderAt has passed and hasn't been returned     */
  /*  yet. A hit gets queued once (nextReminderAt is cleared the same   */
  /*  tick), and Admin/Front Desk sees it as a blocking modal:          */
  /*    - Mark Returned    → returned = true, reminder stops for good.  */
  /*    - Remind Me Later  → nextReminderAt = now + Admin's snoozeMin.  */
  /*  Controlled by notificationSettings.standbyTv (Settings →          */
  /*  Notification Settings → Standby TV Return Reminder).              */
  /* ---------------------------------------------------------------- */
  const standbyLoansRef = useRef(standbyLoans);
  useEffect(() => { standbyLoansRef.current = standbyLoans; }, [standbyLoans]);

  useEffect(() => {
    const t = setInterval(() => {
      const standbySettings = notificationSettings.standbyTv || {};
      if (!standbySettings.enabled) return;
      const currentLoans = standbyLoansRef.current;
      const due = currentLoans.filter((l) => !l.returned && l.nextReminderAt && Date.now() >= l.nextReminderAt);
      if (!due.length) return;

      setStandbyLoans((ls) => ls.map((l) => (due.some((d) => d.id === l.id) ? { ...l, nextReminderAt: null } : l)));

      if (role !== "admin" && role !== "frontdesk") return;
      const additions = due.map((l) => ({ ...l, ts: Date.now() }));
      setStandbyTvReminderQueue((q) => [...q, ...additions]);
      playNotificationTypeSound(notificationSettings, "standbyTvReminder");
      additions.forEach((r) => fireBrowserNotification(
        `Standby TV due back — Job #${r.jobId}`,
        `${r.tvGiven || "Standby unit"} given to ${r.customer || "the customer"} is due back (${r.days} day${r.days === 1 ? "" : "s"} agreed).`,
        `standby-${r.id}`
      ));
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, notificationSettings]);

  /* Surfaces the oldest pending standby-TV alert as a blocking popup. */
  useEffect(() => {
    if ((role !== "admin" && role !== "frontdesk") || holdPopupsForNewJob) return;
    if (!standbyTvReminderPopup && standbyTvReminderQueue.length) {
      setStandbyTvReminderPopup(standbyTvReminderQueue[0]);
    }
  }, [standbyTvReminderQueue, standbyTvReminderPopup, role, holdPopupsForNewJob]);

  /* Auto-clears the popup/queue entry if the loan gets marked returned
     through some other path (e.g. the Standby TVs list) while showing. */
  useEffect(() => {
    setStandbyTvReminderQueue((q) => q.filter((r) => {
      const l = standbyLoans.find((ll) => ll.id === r.id);
      return l && !l.returned;
    }));
  }, [standbyLoans]);
  useEffect(() => {
    setStandbyTvReminderPopup((r) => {
      if (!r) return r;
      const l = standbyLoans.find((ll) => ll.id === r.id);
      return l && !l.returned ? r : null;
    });
  }, [standbyLoans]);

  function snoozeStandbyReminder(reminder) {
    setStandbyLoans((ls) => ls.map((l) => (l.id === reminder.id ? { ...l, nextReminderAt: Date.now() + standbyTvSnoozeMs(notificationSettings) } : l)));
    setStandbyTvReminderQueue((q) => q.filter((r) => r.id !== reminder.id));
    setStandbyTvReminderPopup(null);
    pushToast(`Snoozed — you'll be reminded again in ${(notificationSettings.standbyTv || {}).snoozeMin || 60} minutes for ${reminder.jobId}.`, "alert");
  }

  /* ---------------------------------------------------------------- */
  /*  30-MINUTE PRE-VISIT REMINDER — for outdoor field visits with an    */
  /*  accepted, scheduled clock time. Fires once, ~30 minutes before     */
  /*  visitStartTime: the assigned outdoor technician gets an "upcoming  */
  /*  visit" nudge, and Admin/Front Desk independently gets a "follow up */
  /*  with the technician" nudge — separate flags so each side gets its  */
  /*  own notification whenever THAT role happens to be logged in during */
  /*  the 30-minute window, regardless of which role triggered the other.*/
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const outdoorTechSettings = notificationSettings.outdoor_tech || {};
      const officeSettings = (role === "admin" ? notificationSettings.admin : notificationSettings.frontdesk) || {};
      const previsitWindowMs = (outdoorTechSettings.previsitReminderMin || 30) * 60 * 1000;
      const currentJobs = jobsRef.current;
      let changed = false;
      const techDue = [];
      const frontdeskDue = [];
      const updated = currentJobs.map((j) => {
        if (j.jobType !== "outdoor" || !j.visitStartTime || j.visitAcceptance !== "accepted") return j;
        if (!ACTIVE_JOB_STATUSES.includes(j.status)) return j;
        const msUntilVisit = j.visitStartTime - Date.now();
        if (!(msUntilVisit > 0 && msUntilVisit <= previsitWindowMs)) return j;

        let patch = null;
        if (!j.preVisitTechReminderSent && role === "outdoor_tech" && activeTechId === j.assignedTech && outdoorTechSettings.enabled) {
          patch = { ...j, preVisitTechReminderSent: true };
          techDue.push(patch);
          changed = true;
        }
        if (!j.preVisitFrontdeskReminderSent && (role === "admin" || role === "frontdesk") && officeSettings.enabled) {
          patch = { ...(patch || j), preVisitFrontdeskReminderSent: true };
          frontdeskDue.push(patch);
          changed = true;
        }
        return patch || j;
      });

      if (changed) {
        setJobs(updated);
        if (techDue.length) { setUpcomingVisitPopup(techDue[techDue.length - 1]); playNotificationTypeSound(notificationSettings, "previsitReminder"); }
        if (frontdeskDue.length) { setTechFollowupPopup(frontdeskDue[frontdeskDue.length - 1]); playNotificationTypeSound(notificationSettings, "techFollowup"); }
      }
    }, REMINDER_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeTechId, notificationSettings]);

  useEffect(() => {
    setUpcomingVisitPopup((p) => {
      if (!p) return p;
      const j = jobs.find((jj) => jj.id === p.id);
      return j && ACTIVE_JOB_STATUSES.includes(j.status) ? p : null;
    });
    setTechFollowupPopup((p) => {
      if (!p) return p;
      const j = jobs.find((jj) => jj.id === p.id);
      return j && ACTIVE_JOB_STATUSES.includes(j.status) ? p : null;
    });
  }, [jobs]);

  /* LIVE GPS TRACKING — while an Indoor/Outdoor Technician is clocked in
     and actively using the app on their own device, this continuously
     watches their position and reports it into liveLocations so Admin's
     Live Tracking view can show where they currently are, not just their
     one-time clock-in snapshot. Stops the moment they clock out (or this
     effect re-runs and finds them no longer on an open shift). Honest
     limitation: this only reports for whichever technician's session is
     actually open in a browser right now — there's no backend here to
     receive a location from a technician's phone while Admin is looking
     at a different session, so in this single-session demo, only one
     technician's location can be "live" at a time. A real multi-device
     rollout would have each phone reporting independently to a shared
     backend, making every technician live simultaneously. */
  useEffect(() => {
    if ((role !== "indoor_tech" && role !== "outdoor_tech") || !activeTechId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const onShift = attendance.some((a) => a.userId === activeTechId && !a.clockOut && isSameDay(a.clockIn));
    if (!onShift) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLiveLocations((ll) => ({
          ...ll,
          [activeTechId]: {
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy), ts: Date.now(),
          },
        }));
      },
      () => { /* permission denied or unavailable — silently skip live tracking */ },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeTechId, attendance]);

  /* Technician-side notification: the moment Admin/Front Desk marks a job's
     customer confirmation as OK, pop it up on that technician's screen —
     wherever they are in the app — so they know they're clear to proceed.
     A decline pops the equivalent "pack up and return" notification. */
  useEffect(() => {
    if (role !== "indoor_tech" || !activeTechId) return;
    const newlyConfirmed = jobs.find((j) => j.assignedTech === activeTechId && j.approvalStage === "confirmed");
    if (newlyConfirmed && (!confirmedRepairPopup || confirmedRepairPopup.id !== newlyConfirmed.id)) {
      setConfirmedRepairPopup(newlyConfirmed);
    }
    const newlyDeclined = jobs.find((j) => j.assignedTech === activeTechId && j.approvalStage === "declined");
    if (newlyDeclined && (!declinedRepairPopup || declinedRepairPopup.id !== newlyDeclined.id)) {
      setDeclinedRepairPopup(newlyDeclined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role, activeTechId]);

  /* Outdoor-technician-side notification: the moment Admin/Front Desk
     schedules a field visit and assigns it to this technician
     (visitAcceptance → "pending"), pop it up as a blocking modal so they
     see it wherever they are in the app, and can Accept or hand it back
     (Decline reuses the same requestReassignment flow a regular job uses,
     which immediately notifies Admin/Front Desk to reassign it). */
  useEffect(() => {
    if (role !== "outdoor_tech" || !activeTechId) return;
    const pendingVisit = jobs.find((j) => j.assignedTech === activeTechId && j.visitAcceptance === "pending");
    if (pendingVisit && (!outdoorVisitRequestPopup || outdoorVisitRequestPopup.id !== pendingVisit.id)) {
      setOutdoorVisitRequestPopup(pendingVisit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role, activeTechId]);

  useEffect(() => {
    setOutdoorVisitRequestPopup((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.id);
      return j && j.visitAcceptance === "pending" ? j : null;
    });
  }, [jobs]);

  /* Admin/Front Desk-side notification: every new repair status update a
     technician submits (approvalStage → "pending_review") gets queued as
     a full-screen blocking popup — shown one at a time, in order. The
     dashboard underneath stays hidden by the modal backdrop until each
     one is dismissed, and dismissing one automatically opens the next. */
  useEffect(() => {
    if (role !== "admin" && role !== "frontdesk") return;
    const freshRequests = jobs.filter(
      (j) => j.approvalStage === "pending_review" && !notifiedRepairRequestsRef.current.has(j.id)
    );
    if (freshRequests.length > 0) {
      freshRequests.forEach((j) => notifiedRepairRequestsRef.current.add(j.id));
      setRepairRequestQueue((q) => [...q, ...freshRequests]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role]);

  useEffect(() => {
    if (!activeRepairRequestPopup && repairRequestQueue.length > 0) {
      setActiveRepairRequestPopup(repairRequestQueue[0]);
      setRepairRequestQueue((q) => q.slice(1));
    }
  }, [activeRepairRequestPopup, repairRequestQueue]);

  /* Admin/Front Desk-side notification: the instant a technician hands a
     job back as "can't do this job" (reassignmentRequested → true), it
     queues as a full-screen blocking popup — same one-at-a-time pattern
     as the repair-request queue above — so it never waits for the 30-min
     unassigned-tech reminder cycle to surface it. */
  useEffect(() => {
    if (role !== "admin" && role !== "frontdesk") return;
    const freshReassignments = jobs.filter(
      (j) => j.reassignmentRequested && !notifiedReassignmentRef.current.has(j.id)
    );
    if (freshReassignments.length > 0) {
      freshReassignments.forEach((j) => notifiedReassignmentRef.current.add(j.id));
      setReassignmentQueue((q) => [...q, ...freshReassignments]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role]);

  useEffect(() => {
    if (!activeReassignmentPopup && reassignmentQueue.length > 0) {
      setActiveReassignmentPopup(reassignmentQueue[0]);
      setReassignmentQueue((q) => q.slice(1));
    }
  }, [activeReassignmentPopup, reassignmentQueue]);

  /* Technician-side notification: the moment Admin/Front Desk requests an
     on-demand status update (updateRequested → true) for a job assigned to
     this technician, pop it up as a blocking modal so they can respond
     right away instead of waiting for the next scheduled check-in. */
  useEffect(() => {
    if (role !== "indoor_tech" || !activeTechId) return;
    const pending = jobs.find((j) => j.assignedTech === activeTechId && j.updateRequested);
    if (pending && (!techUpdateRequestPopup || techUpdateRequestPopup.id !== pending.id)) {
      setTechUpdateRequestPopup(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role, activeTechId]);

  useEffect(() => {
    setTechUpdateRequestPopup((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.id);
      return j && j.updateRequested ? j : null;
    });
  }, [jobs]);

  /* Admin/Front Desk-side notification: the instant a technician responds
     to a requested update (pendingCustomerUpdate gets set), it queues as a
     blocking popup — same one-at-a-time pattern as the repair-request and
     reassignment queues above — so Admin/Front Desk can review, tweak the
     customer-facing message, and choose SMS and/or WhatsApp before it goes
     out. */
  useEffect(() => {
    if (role !== "admin" && role !== "frontdesk") return;
    const freshUpdates = jobs.filter(
      (j) => j.pendingCustomerUpdate && !notifiedTechUpdateRef.current.has(j.id)
    );
    if (freshUpdates.length > 0) {
      freshUpdates.forEach((j) => notifiedTechUpdateRef.current.add(j.id));
      setTechUpdateFeedbackQueue((q) => [...q, ...freshUpdates]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, role]);

  useEffect(() => {
    if (!activeTechUpdateFeedback && techUpdateFeedbackQueue.length > 0) {
      setActiveTechUpdateFeedback(techUpdateFeedbackQueue[0]);
      setTechUpdateFeedbackQueue((q) => q.slice(1));
    }
  }, [activeTechUpdateFeedback, techUpdateFeedbackQueue]);

  function pushToast(message, kind = "sms") {
    setToast({ message, kind, id: Math.random() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }

  function sendSms(phone, jobId, message) {
    appendSmsLog({ ts: Date.now(), phone, jobId, message });
    pushToast(`SMS → ${phone}: ${message}`, "sms");
  }

  /* Handles the "Send Customer Update via WhatsApp/SMS" action from a
     reminder card: builds the templated message, opens wa.me in a new
     tab, logs it, and (for stage 2+ status updates) also applies the
     chosen status to the job so the reminder cycle reflects reality. */
  /* Handles "Send Customer Update" from a reminder card, for either
     channel. Builds the same templated message either way, opens wa.me
     for WhatsApp or just logs for SMS, and (for stage 2+ status updates)
     applies the chosen status to the job so the reminder cycle reflects
     reality — identical regardless of which button was tapped. */
  function sendReminderUpdate(channel, reminder, statusLabel, days, reason, customReason, otherSubStatus) {
    const opt = statusLabel ? REMINDER_STATUS_OPTIONS.find((o) => o.label === statusLabel) : null;
    const effectiveStatusKey = opt ? (opt.jobStatus === "others" ? (otherSubStatus || OTHER_SUB_STATUS_OPTIONS[0]) : opt.jobStatus) : null;
    const message = buildReminderMessage(reminder, effectiveStatusKey, days, reason, customReason);

    if (channel === "whatsapp") {
      window.open(waLink(reminder.phone, message), "_blank", "noopener,noreferrer");
      appendSmsLog({ ts: Date.now(), phone: reminder.phone, jobId: reminder.jobId, message: `[WhatsApp] ${message}` });
      pushToast(`WhatsApp update opened for ${reminder.jobId}.`, "sms");
    } else {
      sendSms(reminder.phone, reminder.jobId, message);
    }

    if (reminder.stage > 1 && effectiveStatusKey) {
      const statusLabelForNote = STATUS_META[effectiveStatusKey]?.label || effectiveStatusKey;
      const reasonBit = effectiveStatusKey === "in_repair" && reason
        ? ` (${[reason, (customReason || "").trim()].filter(Boolean).join(" — ")})`
        : "";
      const patch = {
        status: effectiveStatusKey,
        note: `Reminder update — customer notified: ${statusLabelForNote}${effectiveStatusKey === "waiting_for_spares" && days ? ` (${days}-day wait)` : ""}${reasonBit}.`,
        by: "Reminder System",
      };
      if (effectiveStatusKey === "waiting_for_spares" && days) {
        // Switch this job onto once-a-day reminders for the wait window instead
        // of the usual 2-hour cycle.
        patch.spareWaitDays = days;
        patch.spareOrderedAt = Date.now();
        patch.spareWaitUntil = Date.now() + days * 24 * H;
        patch.dailyRemindersSent = 0;
      } else {
        // Any other status choice ends an active spare-wait window early.
        patch.spareWaitUntil = null;
      }
      updateJob(reminder.jobId, patch);
    }
    setReminders((rs) => rs.filter((r) => r.id !== reminder.id));
    setPopupReminder((r) => (r && r.id === reminder.id ? null : r));
  }
  const sendWhatsAppUpdate = (reminder, statusLabel, days, reason, customReason, otherSubStatus) =>
    sendReminderUpdate("whatsapp", reminder, statusLabel, days, reason, customReason, otherSubStatus);
  const sendSmsUpdate = (reminder, statusLabel, days, reason, customReason, otherSubStatus) =>
    sendReminderUpdate("sms", reminder, statusLabel, days, reason, customReason, otherSubStatus);

  function dismissReminder(reminderId) {
    setReminders((rs) => rs.filter((r) => r.id !== reminderId));
    setPopupReminder((r) => (r && r.id === reminderId ? null : r));
  }

  function dismissTechReminder(reminderId) {
    setTechReminders((rs) => rs.filter((r) => r.id !== reminderId));
    setTechReminderPopup((r) => (r && r.id === reminderId ? null : r));
  }

  /* ---------------------------------------------------------------- */
  /*  ATTENDANCE — clock in/out with a one-time GPS snapshot (not        */
  /*  continuous tracking — see the note at the top of this feature).    */
  /* ---------------------------------------------------------------- */
  async function clockIn(userId, userName, roleKey) {
    setClockingIn(true);
    const loc = await getGeoSnapshot();
    setAttendance((a) => [
      { id: `ATT-${Date.now()}`, userId, userName, role: roleKey, clockIn: Date.now(), clockInLocation: loc, clockOut: null, clockOutLocation: null },
      ...a,
    ]);
    setClockingIn(false);
    pushToast(`Clocked in${loc ? " — location captured" : " (location unavailable)"}.`, "ok");
  }

  async function clockOut(recordId) {
    setClockingIn(true);
    const loc = await getGeoSnapshot();
    setAttendance((a) => a.map((r) => (r.id === recordId ? { ...r, clockOut: Date.now(), clockOutLocation: loc } : r)));
    setClockingIn(false);
    pushToast(`Clocked out${loc ? " — location captured" : " (location unavailable)"}.`, "ok");
  }

  /* ---------------------------------------------------------------- */
  /*  ONE-TAP UPDATES — generic "send an update" actions usable from    */
  /*  any job or customer view (Job Cards, Dashboards, Customer Detail),*/
  /*  not just the automated 2-hour reminder flow above. Both channels  */
  /*  share the same status-aware message text; WhatsApp opens wa.me,   */
  /*  SMS just logs (as with every other SMS in this app).              */
  /* ---------------------------------------------------------------- */
  function buildJobUpdateMessage(job) {
    const faultBit = job.fault ? ` Fault: ${job.fault}${job.subFaults && job.subFaults.length ? ` (${job.subFaults.join(", ")})` : ""}.` : "";
    return `Hello ${job.customer}, this is AitechLab LED TV Service Center with an update on your ${job.brand} ${job.model} (Job #${job.id}). Current status: ${job.status}.${faultBit} Thank you for your patience.`;
  }
  function buildCustomerUpdateMessage(customer) {
    return `Hello ${customer.name || "there"}, this is AitechLab LED TV Service Center following up on your enquiry (${customer.customerId}). Let us know if you'd like to go ahead with a repair, or if you have any questions.`;
  }

  function sendWhatsAppToJob(job) {
    const message = buildJobUpdateMessage(job);
    window.open(waLink(job.phone, message), "_blank", "noopener,noreferrer");
    appendSmsLog({ ts: Date.now(), phone: job.phone, jobId: job.id, message: `[WhatsApp] ${message}` });
    pushToast(`WhatsApp opened for ${job.id}.`, "sms");
  }
  function sendSmsToJob(job) {
    sendSms(job.phone, job.id, buildJobUpdateMessage(job));
  }

  function sendWhatsAppToCustomer(customer) {
    const message = buildCustomerUpdateMessage(customer);
    window.open(waLink(customer.phone, message), "_blank", "noopener,noreferrer");
    appendSmsLog({ ts: Date.now(), phone: customer.phone, jobId: customer.customerId, message: `[WhatsApp] ${message}` });
    pushToast(`WhatsApp opened for ${customer.customerId}.`, "sms");
  }
  function sendSmsToCustomer(customer) {
    sendSms(customer.phone, customer.customerId, buildCustomerUpdateMessage(customer));
  }

  /* One-tap "Call Now" — hands off to the device's native dialer via a
     tel: link, and logs that a call was placed so it shows up alongside
     the SMS/WhatsApp history for that job or customer. */
  function callJob(job) {
    window.location.href = telLink(job.phone);
    appendSmsLog({ ts: Date.now(), phone: job.phone, jobId: job.id, message: `[Call] Called ${job.customer}.` });
  }
  function callCustomer(customer) {
    window.location.href = telLink(customer.phone);
    appendSmsLog({ ts: Date.now(), phone: customer.phone, jobId: customer.customerId, message: `[Call] Called ${customer.name || customer.customerId}.` });
  }
  function callReminder(reminder) {
    window.location.href = telLink(reminder.phone);
    appendSmsLog({ ts: Date.now(), phone: reminder.phone, jobId: reminder.jobId, message: `[Call] Called ${reminder.customer}.` });
  }

  const techMap = useMemo(() => Object.fromEntries(technicians.map((t) => [t.id, t])), [technicians]);
  const partMap = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p])), [parts]);

  const overdueJobs = useMemo(
    () => jobs.filter((j) =>
      ACTIVE_JOB_STATUSES.includes(j.status) &&
      Date.now() - j.intake > 2 * H &&
      !(j.spareWaitUntil && Date.now() < j.spareWaitUntil)
    ),
    [jobs, tick]
  );

  // Repair requests awaiting Admin/Front Desk action: a technician has
  // submitted a diagnosis ("pending_review"), or an estimate has been set
  // and the customer's confirmation is still outstanding ("awaiting_customer").
  const repairAlerts = useMemo(
    () => jobs.filter((j) => j.approvalStage === "pending_review" || j.approvalStage === "awaiting_customer"),
    [jobs]
  );

  const revenueToday = useMemo(
    () => invoices.filter((i) => i.paymentStatus === "Paid" && isSameDay(i.paidAt)).reduce((s, i) => s + i.total, 0),
    [invoices, tick]
  );
  const outstandingDues = useMemo(
    () => invoices.filter((i) => i.paymentStatus === "Pending").reduce((s, i) => s + i.total, 0),
    [invoices]
  );
  const pendingOrders = useMemo(
    () => jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status)),
    [jobs]
  );

  /* ---------------- job actions ---------------- */
  function createJob(data, creator = { role: "frontdesk", label: "Front Desk", techId: null }) {
    const id = data.id || nextDailyId("JID");
    const jobType = data.jobType === "outdoor" ? "outdoor" : "indoor"; // service_type
    const job = {
      id, ...data, intake: Date.now(), status: DEFAULT_STATUS, // intake doubles as created_at
      assignedTech: creator.techId || null,
      partsUsed: [], createdBy: creator.role, invoiced: false, remindersSent: 0, unassignedRemindersSent: 0,
      isLabelPrinted: false, labelPrintedAt: null,
      nextLabelNotificationAt: Date.now() + labelPrintDelayMs(notificationSettings, jobType),
      updates: [{ ts: Date.now(), by: creator.label, note: "Job card created on intake.", status: DEFAULT_STATUS }],
    };
    setJobs((j) => [job, ...j]);
    if (smsDispatchMode === "automatic") {
      sendSms(data.phone, id, `Hi ${data.customer}, your ${data.brand} ${data.model} has been received. Job ID: ${id}. We'll update you on progress.`);
    }
    if (data.customerId) {
      setCustomers((cs) => cs.map((c) => (c.customerId === data.customerId ? { ...c, status: "Active Customer" } : c)));
    }
    return job;
  }

  /* ---------------------------------------------------------------- */
  /*  CID LAYER — mirrors §3.1 of the Android Call Launcher doc: a      */
  /*  phone number becomes a Customer record (CID) on first contact,    */
  /*  independent of whether it ever turns into a job. Repeat numbers   */
  /*  are recognized instead of duplicated.                             */
  /* ---------------------------------------------------------------- */
  function findCustomerByPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return customers.find((c) => c.phone.replace(/\D/g, "") === digits);
  }

  function createCustomer({ phone, name, note, location, currentLocation, source = "Inbound Call", customerType = "indoor" }) {
    const existing = findCustomerByPhone(phone);
    if (existing) {
      if (note) addCustomerNote(existing.customerId, note, "Front Desk");
      if (location) updateCustomer(existing.customerId, { location });
      if (currentLocation) updateCustomer(existing.customerId, { currentLocation });
      return existing;
    }
    const customerId = nextDailyId(customerType === "outdoor" ? "COD" : "CID");
    const record = {
      customerId, name: name || "", phone, location: location || "", currentLocation: currentLocation || null,
      status: "Enquiry / Lead", source, customerType,
      notes: note ? [{ ts: Date.now(), by: "Front Desk", note }] : [],
      createdAt: Date.now(),
    };
    setCustomers((cs) => [record, ...cs]);
    pushToast(`New enquiry logged — ${customerId}.`, "ok");
    setJobPromptCustomer(record); // "Create Job ID now?" prompt
    return record;
  }

  function updateCustomer(customerId, patch) {
    setCustomers((cs) => cs.map((c) => (c.customerId === customerId ? { ...c, ...patch } : c)));
  }

  function addCustomerNote(customerId, note, by = "Front Desk") {
    if (!note || !note.trim()) return;
    setCustomers((cs) => cs.map((c) =>
      c.customerId === customerId ? { ...c, notes: [{ ts: Date.now(), by, note }, ...c.notes] } : c
    ));
  }

  function assignTech(jobId, techId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, assignedTech: techId } : j)));
    const job = jobs.find((j) => j.id === jobId);
    const tech = techMap[techId];
    if (job && tech) sendSms(job.phone, jobId, `Hi ${job.customer}, technician ${tech.name} has been assigned to your ${job.brand} ${job.model} repair (${jobId}).`);
  }

  /* EXTRA WORK — ad-hoc tasks Admin/Front Desk hand a technician outside
     the normal job-card flow (e.g. "restock the parts bin", "clean bench
     2", "help unload the outdoor van"). Shows up in the technician's own
     dashboard as a to-do they can mark complete themselves; Admin/Front
     Desk can also mark it done or remove it from the Technicians view. */
  function assignExtraWork(techId, { title, notes, priority, dueAt }, by) {
    const tech = techMap[techId];
    const task = {
      id: `TASK-${Date.now()}`, techId, title: (title || "").trim(),
      notes: notes || "", priority: priority || "normal", dueAt: dueAt || null,
      status: "pending", assignedBy: by, createdAt: Date.now(),
    };
    if (!task.title) return null;
    setExtraTasks((ts) => [task, ...ts]);
    pushToast(`Extra work assigned to ${tech?.name || "technician"}: ${task.title}`, "ok");
    fireBrowserNotification(`New task — ${tech?.name || "Technician"}`, task.title, `task-${task.id}`);
    return task;
  }
  function completeExtraWork(taskId, by) {
    setExtraTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: "done", completedAt: Date.now(), completedBy: by || t.completedBy } : t)));
  }
  function deleteExtraWork(taskId) {
    setExtraTasks((ts) => ts.filter((t) => t.id !== taskId));
  }

  /* A technician hands a job back — e.g. it needs a specialist they aren't,
     or it's outside their workload. Unassigns the job immediately (so it
     drops off that technician's My Jobs and stops their 1-hour reminder
     cycle) and flags it, which the notification effect above turns into
     an instant blocking popup for Admin/Front Desk. */
  function requestReassignment(jobId, reason, byTechId) {
    const techName = techMap[byTechId]?.name || "Technician";
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, assignedTech: null, reassignmentRequested: true, reassignmentReason: reason || "",
      updates: [...j.updates, {
        ts: Date.now(), by: techName,
        note: `Unable to complete this job — requested reassignment${reason ? `: ${reason}` : "."}`,
        status: j.status,
      }],
    } : j)));
    pushToast(`Reassignment requested for ${jobId} — Front Desk/Admin notified.`, "alert");
  }

  /* Admin/Front Desk resolving a reassignment request: assigns the new
     technician and clears the flag so the job can be handed back again
     later if needed (a fresh request re-notifies, since this clears the
     "already notified" marker too). */
  function reassignJob(jobId, techId, by) {
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, assignedTech: techId, reassignmentRequested: false, reassignmentReason: "",
      updates: [...j.updates, { ts: Date.now(), by, note: `Reassigned to ${techMap[techId]?.name || "another technician"}.`, status: j.status }],
    } : j)));
    notifiedReassignmentRef.current.delete(jobId);
    const job = jobs.find((j) => j.id === jobId);
    const tech = techMap[techId];
    if (job && tech) sendSms(job.phone, jobId, `Hi ${job.customer}, technician ${tech.name} has been assigned to your ${job.brand} ${job.model} repair (${jobId}).`);
  }

  /* Admin/Front Desk scheduling an outdoor field visit for a COD (outdoor)
     customer: creates the JOD job card right away — assigned to the chosen
     technician — but deliberately does NOT SMS the customer yet. The job
     sits with visitAcceptance: "pending" until the technician accepts (see
     acceptOutdoorVisit below), which is when the customer actually hears
     about it — avoids notifying them before a human has confirmed. */
  function scheduleOutdoorVisit(customer, techId, visitTime, creator) {
    const jobId = nextDailyId("JOD");
    const job = {
      id: jobId, customerId: customer.customerId, customer: customer.name || "", phone: customer.phone,
      location: customer.location || "", brand: "Field Visit", model: "(to be diagnosed on-site)",
      issue: "Outdoor service call — technician to diagnose the fault on arrival.",
      accessories: "", estimate: 0, fault: DEFAULT_FAULTS[0], subFaults: [], faultPhoto: null,
      jobType: "outdoor", intake: Date.now(), status: DEFAULT_STATUS, // intake doubles as created_at
      isLabelPrinted: false, labelPrintedAt: null,
      nextLabelNotificationAt: Date.now() + labelPrintDelayMs(notificationSettings, "outdoor"),
      assignedTech: techId, estimatedVisitTime: visitTime, visitStartTime: parseVisitTimeToTimestamp(visitTime),
      visitAcceptance: "pending", preVisitTechReminderSent: false, preVisitFrontdeskReminderSent: false,
      partsUsed: [], createdBy: creator.role, invoiced: false, remindersSent: 0, unassignedRemindersSent: 0,
      updates: [{
        ts: Date.now(), by: creator.label,
        note: `Field visit scheduled for ${customer.name || customer.phone} — assigned to ${techMap[techId]?.name || "technician"}, awaiting acceptance. Estimated visit: ${visitTime}.`,
        status: DEFAULT_STATUS,
      }],
    };
    setJobs((js) => [job, ...js]);
    setCustomers((cs) => cs.map((c) => (c.customerId === customer.customerId ? { ...c, status: "Active Customer" } : c)));
    return job;
  }

  /* The assigned technician accepting a scheduled field visit — this is
     the moment the customer actually gets notified, by design (see note
     above): SMS includes the technician's name, the CID, the JID, and the
     estimated visit time, exactly as the customer needs to know. */
  function acceptOutdoorVisit(jobId) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const tech = techMap[job.assignedTech];
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, visitAcceptance: "accepted",
      updates: [...j.updates, {
        ts: Date.now(), by: tech?.name || "Technician",
        note: `Accepted the field visit — estimated visit time ${job.estimatedVisitTime}.`,
        status: j.status,
      }],
    } : j)));
    if (tech) {
      sendSms(
        job.phone, jobId,
        `Hi ${job.customer || "there"}, technician ${tech.name} has been assigned for your LED TV service. CID: ${job.customerId}. JID: ${jobId}. Estimated visiting time: ${job.estimatedVisitTime}. Our service center location is ${SERVICE_CENTER_LOCATION_URL}.`
      );
    }
    pushToast(`Field visit accepted for ${jobId}.`, "ok");
  }

  /* Admin/Front Desk asking an assigned technician for a fresh status
     update on demand, outside the normal 2-hour cycle. */
  function requestJobUpdate(jobId, by) {
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, updateRequested: true,
      updates: [...j.updates, { ts: Date.now(), by, note: "Requested a current status update from the assigned technician.", status: j.status }],
    } : j)));
    pushToast(`Update requested for ${jobId} — technician notified.`, "alert");
  }

  /* The technician's response to a requested update: applies the real
     status to the job right away, but does NOT message the customer yet —
     it composes a suggested customer-facing message and hands it to
     Admin/Front Desk (via pendingCustomerUpdate) to review, edit, and
     actually send. */
  function submitJobUpdateResponse(jobId, statusKey, note, techName) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const label = STATUS_META[statusKey]?.label || statusKey;
    const message = `Hi ${job.customer || "there"}, update on your TV (Job #${jobId}): ${label}.${note ? ` ${note}` : ""}`;
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, status: statusKey, updateRequested: false,
      pendingCustomerUpdate: { statusKey, note: note || "", message, ts: Date.now(), by: techName },
      updates: [...j.updates, { ts: Date.now(), by: techName, note: `Status update submitted: ${label}${note ? ` — ${note}` : ""}.`, status: statusKey }],
    } : j)));
    pushToast(`Update submitted for ${jobId} — Front Desk/Admin notified.`, "ok");
  }

  /* Admin/Front Desk actually sending the (possibly edited) customer
     message after reviewing a technician's response — either channel can
     be used, independently, so both can be sent if wanted. */
  function sendJobUpdateToCustomer(jobId, channel, message) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (channel === "whatsapp") {
      window.open(waLink(job.phone, message), "_blank", "noopener,noreferrer");
      appendSmsLog({ ts: Date.now(), phone: job.phone, jobId, message: `[WhatsApp] ${message}` });
      pushToast(`WhatsApp update opened for ${jobId}.`, "sms");
    } else {
      sendSms(job.phone, jobId, message);
    }
  }

  /* Clears the reviewed update off the job once Admin/Front Desk is done
     with it (whether or not they sent anything), and lets a future
     request re-notify by dropping the "already queued" marker. */
  function dismissJobUpdateFeedback(jobId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, pendingCustomerUpdate: null } : j)));
    notifiedTechUpdateRef.current.delete(jobId);
  }

  function updateJob(jobId, { status, note, partsUsedDelta, by, fault, subFaults, readyPhoto, location, spareWaitDays, spareOrderedAt, spareWaitUntil, dailyRemindersSent }) {
    setJobs((js) =>
      js.map((j) => {
        if (j.id !== jobId) return j;
        let partsUsed = j.partsUsed;
        if (partsUsedDelta && partsUsedDelta.length) {
          partsUsed = [...j.partsUsed];
          partsUsedDelta.forEach(({ partId, qty, remark }) => {
            // Merge into an existing line only if the remark also matches —
            // that way a distinct remark on a repeat use of the same part
            // stays attached to its own line instead of being overwritten.
            const idx = partsUsed.findIndex((p) => p.partId === partId && (p.remark || "") === (remark || ""));
            if (idx >= 0) partsUsed[idx] = { ...partsUsed[idx], qty: partsUsed[idx].qty + qty };
            else partsUsed.push({ partId, qty, remark: remark || "" });
          });
        }
        return {
          ...j, status: status || j.status, partsUsed,
          fault: fault !== undefined ? fault : j.fault,
          subFaults: subFaults !== undefined ? subFaults : j.subFaults,
          readyPhoto: readyPhoto !== undefined ? readyPhoto : j.readyPhoto,
          location: location !== undefined ? location : j.location,
          spareWaitDays: spareWaitDays !== undefined ? spareWaitDays : j.spareWaitDays,
          spareOrderedAt: spareOrderedAt !== undefined ? spareOrderedAt : j.spareOrderedAt,
          spareWaitUntil: spareWaitUntil !== undefined ? spareWaitUntil : j.spareWaitUntil,
          dailyRemindersSent: dailyRemindersSent !== undefined ? dailyRemindersSent : j.dailyRemindersSent,
          updates: [...j.updates, { ts: Date.now(), by, note, status: status || j.status }],
        };
      })
    );
    if (partsUsedDelta && partsUsedDelta.length) {
      setParts((ps) => ps.map((p) => {
        const usedQty = partsUsedDelta.filter((d) => d.partId === p.id).reduce((sum, d) => sum + d.qty, 0);
        return usedQty > 0 ? { ...p, qty: Math.max(0, p.qty - usedQty) } : p;
      }));
    }
    const job = jobs.find((j) => j.id === jobId);
    if (job) {
      const parts_txt = partsUsedDelta && partsUsedDelta.length
        ? ` Parts used: ${partsUsedDelta.map((d) => `${partMap[d.partId]?.name} x${d.qty}${d.remark ? ` (${d.remark})` : ""}`).join(", ")}.`
        : "";
      const fault_txt = subFaults && subFaults.length ? ` Section fault(s): ${subFaults.join(", ")}.` : "";
      sendSms(job.phone, jobId, `Hi ${job.customer}, update on ${jobId}: status is now "${status || job.status}". ${note || ""}${parts_txt}${fault_txt}`.trim());
    }
  }

  /* ---------------------------------------------------------------- */
  /*  REPAIR APPROVAL WORKFLOW                                          */
  /*  1. Indoor technician submits a diagnosis/remarks + status from    */
  /*     "My Jobs" (no pricing, no customer contact info visible).      */
  /*  2. Admin/Front Desk see it as a "Repair Request" in the bell      */
  /*     menu, add a repair estimate + service charge, and it moves to  */
  /*     "awaiting customer" — they contact the customer via            */
  /*     Call/SMS/WhatsApp (already available) to get approval.        */
  /*  3a. Customer says yes → Admin/Front Desk mark it confirmed, which */
  /*      pops a notification on the technician's dashboard so they     */
  /*      know they're clear to proceed. Once the technician marks the  */
  /*      repair Completed, a full invoice (parts + repair + service    */
  /*      charge) is generated automatically.                          */
  /*  3b. Customer says no → Admin/Front Desk mark it declined, which    */
  /*      pops a "pack up and return" notification on the technician's  */
  /*      dashboard, and a service-charge-only invoice is generated      */
  /*      automatically right away (no repair was done).                */
  /* ---------------------------------------------------------------- */
  function submitRepairReport(jobId, status, remarks, by, fault, subFaults) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const alreadyApproved = job.approvalStage === "confirmed" || job.approvalStage === "acknowledged";
    const isCompleting = status === "ready_for_delivery" && alreadyApproved;

    setJobs((js) => js.map((j) => {
      if (j.id !== jobId) return j;
      const faultPatch = {
        fault: fault !== undefined ? fault : j.fault,
        subFaults: subFaults !== undefined ? subFaults : j.subFaults,
      };
      if (isCompleting) {
        return {
          ...j, ...faultPatch, status, repairRemarks: remarks, invoiced: true,
          updates: [...j.updates, { ts: Date.now(), by, note: `Repair completed: ${remarks}. Invoice generated.`, status }],
        };
      }
      if (alreadyApproved) {
        return {
          ...j, ...faultPatch, status: status || j.status, repairRemarks: remarks,
          updates: [...j.updates, { ts: Date.now(), by, note: `Repair update: ${remarks}`, status: status || j.status }],
        };
      }
      return {
        ...j, ...faultPatch, status: status || j.status, repairRemarks: remarks, approvalStage: "pending_review",
        updates: [...j.updates, { ts: Date.now(), by, note: `Repair diagnosis submitted: ${remarks}`, status: status || j.status }],
      };
    }));

    if (isCompleting) {
      const partItems = job.partsUsed.map((pu) => ({
        desc: `${partMap[pu.partId]?.name || pu.partId} x${pu.qty}${pu.remark ? ` (${pu.remark})` : ""}`,
        amount: (partMap[pu.partId]?.cost || 0) * pu.qty,
      }));
      const items = [
        ...partItems,
        { desc: "Repair / Labor Charge", amount: job.estimate || 0 },
        { desc: "Service Charge", amount: job.serviceCharge || 0 },
      ];
      const total = items.reduce((s, i) => s + i.amount, 0);
      const inv = {
        id: nextInvId(), jobId: job.id, customer: job.customer, items, total,
        paymentMethod: "Cash", paymentStatus: "Pending",
        createdAt: Date.now(), paidAt: null,
      };
      setInvoices((iv) => [inv, ...iv]);
      pushToast(`Repair completed for ${jobId} — invoice ${inv.id} auto-generated (${fmtMoney(total)}).`, "ok");
    } else if (alreadyApproved) {
      pushToast(`Progress update submitted for ${jobId}.`, "sms");
    } else {
      pushToast(`Repair update submitted for ${jobId} — awaiting Admin/Front Desk review.`, "alert");
    }
  }

  function reviewRepairRequest(jobId, estimate, serviceCharge, by) {
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, estimate: Number(estimate) || j.estimate, serviceCharge: Number(serviceCharge) || 0, approvalStage: "awaiting_customer",
      updates: [...j.updates, {
        ts: Date.now(), by,
        note: `Repair estimate ₹${estimate} + service charge ₹${serviceCharge || 0} (total ${fmtMoney((Number(estimate) || 0) + (Number(serviceCharge) || 0))}) sent — awaiting customer confirmation.`,
        status: j.status,
      }],
    } : j)));
    pushToast(`Estimate sent — contact the customer for approval on ${jobId}.`, "ok");
  }

  function confirmCustomerApproval(jobId, by) {
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, approvalStage: "confirmed",
      updates: [...j.updates, { ts: Date.now(), by, note: "Customer confirmed OK to proceed with repair.", status: j.status }],
    } : j)));
    pushToast(`Customer confirmation recorded for ${jobId}. Technician notified.`, "ok");
  }

  function declineCustomerApproval(jobId, by) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, approvalStage: "declined", status: "return_requested", invoiced: true,
      updates: [...j.updates, { ts: Date.now(), by, note: "Customer did not approve the repair — pack up TV for return. Service charge invoice generated.", status: "return_requested" }],
    } : j)));
    const inv = {
      id: nextInvId(), jobId: job.id, customer: job.customer,
      items: [{ desc: "Diagnostic / Service Charge", amount: job.serviceCharge || 0 }],
      total: job.serviceCharge || 0,
      paymentMethod: "Cash", paymentStatus: "Pending",
      createdAt: Date.now(), paidAt: null,
    };
    setInvoices((iv) => [inv, ...iv]);
    pushToast(`Customer declined repair on ${jobId} — service charge invoice ${inv.id} generated.`, "alert");
  }

  function acknowledgeRepairConfirmation(jobId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, approvalStage: "acknowledged" } : j)));
  }

  function acknowledgeRepairDecline(jobId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? {
      ...j, approvalStage: "declined_acknowledged", status: "returned_unrepaired",
      updates: [...j.updates, { ts: Date.now(), by: j.assignedTech ? (techMap[j.assignedTech]?.name || "Technician") : "Technician", note: "TV packed up — ready for customer return.", status: "returned_unrepaired" }],
    } : j)));
  }

  function createInvoice(job, laborCharge, paymentMethod, paymentStatus) {
    const partItems = job.partsUsed.map((pu) => ({
      desc: `${partMap[pu.partId]?.name || pu.partId} x${pu.qty}${pu.remark ? ` (${pu.remark})` : ""}`,
      amount: (partMap[pu.partId]?.cost || 0) * pu.qty,
    }));
    const items = [...partItems, { desc: "Service & Labor Charge", amount: Number(laborCharge) || 0 }];
    const total = items.reduce((s, i) => s + i.amount, 0);
    const inv = {
      id: nextInvId(), jobId: job.id, customer: job.customer, items, total,
      paymentMethod, paymentStatus,
      createdAt: Date.now(), paidAt: paymentStatus === "Paid" ? Date.now() : null,
    };
    setInvoices((iv) => [inv, ...iv]);
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, invoiced: true } : j)));
    sendSms(job.phone, job.id,
      paymentStatus === "Paid"
        ? `Hi ${job.customer}, invoice ${inv.id} generated for ${fmtMoney(total)}. Payment received via ${paymentMethod}. Thank you!`
        : `Hi ${job.customer}, invoice ${inv.id} generated for ${fmtMoney(total)}. Payment pending (${paymentMethod}).`
    );
    return inv;
  }

  function deleteJob(jobId) {
    setJobs((js) => js.filter((j) => j.id !== jobId));
    setInvoices((iv) => iv.filter((i) => i.jobId !== jobId));
    pushToast(`Job card ${jobId} permanently deleted.`, "alert");
  }

  function deleteTechnician(techId) {
    // Unassign any jobs pointing to this technician first, so they don't
    // end up stuck referencing a deleted tech with no way to reassign.
    setJobs((js) => js.map((j) => (j.assignedTech === techId ? { ...j, assignedTech: null } : j)));
    setTechnicians((ts) => ts.filter((t) => t.id !== techId));
    pushToast(`Technician removed.`, "alert");
  }

  function deleteCustomer(customerId) {
    setCustomers((cs) => cs.filter((c) => c.customerId !== customerId));
    pushToast(`${customerId} permanently deleted.`, "alert");
  }

  function markInvoicePaid(invId) {
    let target = null;
    setInvoices((iv) => iv.map((i) => {
      if (i.id === invId) { target = i; return { ...i, paymentStatus: "Paid", paidAt: Date.now() }; }
      return i;
    }));
    setTimeout(() => {
      if (target) {
        const job = jobs.find((j) => j.id === target.jobId);
        if (job) sendSms(job.phone, job.id, `Hi ${job.customer}, payment of ${fmtMoney(target.total)} received for invoice ${invId}. Thank you!`);
      }
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  PRINT VIEWS (replace whole screen while active)                    */
  /* ------------------------------------------------------------------ */
  if (printJob) return <PrintLabel job={printJob} onBack={() => setPrintJob(null)} onMarkPrinted={markLabelPrinted} />;
  if (printInvoice) return <PrintInvoice invoice={printInvoice} job={jobs.find((j) => j.id === printInvoice.jobId)} onBack={() => setPrintInvoice(null)} />;

  /* ------------------------------------------------------------------ */
  /*  LOGIN / ROLE SELECT                                                 */
  /* ------------------------------------------------------------------ */
  if (!role) {
    return (
      <RoleSelect
        technicians={technicians}
        loginWindowSettings={loginWindowSettings}
        onSelect={(r, techId) => { setRole(r); setActiveTechId(techId || null); setTab("dashboard"); }}
      />
    );
  }

  // Attendance identity for the logged-in user — Admin is exempt from
  // mandatory clock-in, same as the rest of the app's role restrictions.
  const attendanceUserId = role === "frontdesk" ? "frontdesk" : role === "admin" ? null : activeTechId;
  const attendanceUserName = role === "frontdesk" ? "Front Desk" : role === "admin" ? null : techMap[activeTechId]?.name || "Technician";
  const myOpenAttendance = attendanceUserId
    ? attendance.find((a) => a.userId === attendanceUserId && !a.clockOut && isSameDay(a.clockIn))
    : null;
  const requiresClockIn = role !== "admin";

  if (requiresClockIn && !myOpenAttendance) {
    return (
      <ClockInGate
        role={role} userName={attendanceUserName} clockingIn={clockingIn}
        onClockIn={() => clockIn(attendanceUserId, attendanceUserName, role)}
        onSwitchLogin={() => { setRole(null); setActiveTechId(null); }}
      />
    );
  }

  const NAV = {
    admin: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "customers", label: "Customers (CID)", icon: Phone },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
      { id: "standby", label: "Standby TVs", icon: Tv },
      { id: "inventory", label: "Inventory", icon: Package },
      { id: "technicians", label: "Technicians", icon: Users },
      { id: "reports", label: "Work Reports", icon: BarChart3 },
      { id: "attendance", label: "Attendance", icon: Clock },
      { id: "livetracking", label: "Live Tracking", icon: MapPin },
      { id: "sms", label: "SMS Log", icon: MessageSquare },
      { id: "settings", label: "Settings", icon: Wrench },
    ],
    frontdesk: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "customers", label: "Customers (CID)", icon: Phone },
      { id: "newjob", label: "New Job Card", icon: Plus },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
      { id: "standby", label: "Standby TVs", icon: Tv },
      { id: "technicians", label: "Technicians", icon: Users },
      { id: "reports", label: "Work Reports", icon: BarChart3 },
      { id: "attendance", label: "Attendance", icon: Clock },
      { id: "livetracking", label: "Live Tracking", icon: MapPin },
      { id: "sms", label: "SMS Log", icon: MessageSquare },
    ],
    indoor_tech: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "myjobs", label: "My Jobs", icon: Wrench },
    ],
    outdoor_tech: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  };

  const roleLabel = {
    admin: "Admin", frontdesk: "Front Desk",
    indoor_tech: techMap[activeTechId]?.name || "Indoor Technician",
    outdoor_tech: techMap[activeTechId]?.name || "Outdoor Technician",
  };
  const roleSub = {
    admin: "Full access", frontdesk: "Intake desk",
    indoor_tech: techMap[activeTechId]?.specialty || "Indoor Technician",
    outdoor_tech: techMap[activeTechId]?.specialty || "Outdoor Technician",
  };

  // Indoor/Outdoor Technicians never see the 2-hour customer-update cycle
  // (Admin/Front Desk only) — they get their own 1-hour "check this job"
  // reminders instead, scoped to jobs assigned to them.
  const isTechRole = role === "indoor_tech" || role === "outdoor_tech";
  const visibleReminders = isTechRole
    ? techReminders.filter((r) => r.assignedTech === activeTechId)
    : reminders;
  const visibleOverdueJobs = isTechRole
    ? overdueJobs.filter((j) => j.assignedTech === activeTechId)
    : overdueJobs;
  const visiblePopupReminder = isTechRole
    ? (techReminderPopup && techReminderPopup.assignedTech === activeTechId ? techReminderPopup : null)
    : popupReminder;

  return (
    <div className="app-shell" style={{
      fontFamily: FONT_SANS,
      background: `
        radial-gradient(circle at 12% 12%, rgba(255,255,255,0.55), transparent 38%),
        radial-gradient(circle at 88% 22%, rgba(147,197,253,0.55), transparent 45%),
        radial-gradient(circle at 25% 88%, rgba(244,114,182,0.5), transparent 50%),
        radial-gradient(circle at 78% 82%, rgba(196,181,253,0.55), transparent 45%),
        linear-gradient(135deg, #a78bfa 0%, #f0abfc 30%, #93c5fd 65%, #f9a8d4 100%)
      `,
      backgroundAttachment: "fixed",
      color: COLORS.text, minHeight: 620,
      display: "flex", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.5)",
    }}>
      <style>{`
        * { box-sizing: border-box; }
        ::selection { background: ${COLORS.amber}55; }
        ::placeholder { color: ${COLORS.faint}; }
        .navitem:hover { background: ${COLORS.panel2} !important; }
        .rowhover:hover { background: ${COLORS.panel2} !important; }
        .hamburger-btn { display: none; }
        .sidebar-overlay { display: none; }
        .data-row { flex-wrap: wrap; }
        .topbar-actions { margin-left: auto; }

        @media (max-width: 860px) {
          .app-shell { flex-direction: column; min-height: 100vh !important; border-radius: 0 !important; }
          .sidebar {
            position: fixed; top: 0; left: 0; height: 100%; width: 250px !important;
            transform: translateX(-100%); transition: transform .22s ease; z-index: 90;
          }
          .sidebar.open { transform: translateX(0); box-shadow: 0 0 40px rgba(0,0,0,0.5); }
          .sidebar-overlay.open {
            display: block; position: fixed; inset: 0; background: rgba(6,8,11,0.6); z-index: 80;
          }
          .hamburger-btn { display: inline-flex !important; }
          .main-scroll { padding: 14px !important; }
          .dashboard-2col { grid-template-columns: 1fr !important; }
          .form-grid-2col { grid-template-columns: 1fr !important; }
          .form-grid-4col { grid-template-columns: 1fr 1fr !important; }
          .stat-row { gap: 10px !important; }
          .stat-row > div { min-width: 46% !important; }
          .table-scroll { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
          .table-scroll > div { min-width: 560px; }
          .print-chrome-inner { width: 100% !important; max-width: 380px; }
        }
        @media (max-width: 480px) {
          .stat-row > div { min-width: 100% !important; }
          .form-grid-4col { grid-template-columns: 1fr !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>

      {/* ---------------- SIDEBAR ---------------- */}
      <div
        className={`sidebar${mobileNavOpen ? " open" : ""}`}
        style={{
          width: 220, background: COLORS.glass, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
          borderRight: `1px solid ${COLORS.glassBorder}`, display: "flex", flexDirection: "column", flexShrink: 0,
        }}
      >
        <div style={{ padding: "18px 18px 14px", borderBottom: `1px solid ${COLORS.glassBorder}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Tv size={17} color="#1A1300" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: 0.2 }}>AitechLab CRM</div>
              <div style={{ fontSize: 10, color: COLORS.faint, fontFamily: FONT_MONO, letterSpacing: 0.5 }}>LED TV REPAIR SERVICE</div>
            </div>
          </div>
          <button
            className="hamburger-btn"
            onClick={() => setMobileNavOpen(false)}
            style={{ background: "transparent", border: "none", color: COLORS.muted, cursor: "pointer", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
          {NAV[role].map((n) => (
            <button
              key={n.id}
              className="navitem"
              onClick={() => { setTab(n.id); setMobileNavOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                background: tab === n.id ? COLORS.panel2 : "transparent",
                border: tab === n.id ? `1px solid ${COLORS.border}` : "1px solid transparent",
                color: tab === n.id ? COLORS.text : COLORS.muted, cursor: "pointer", textAlign: "left",
                fontSize: 13, fontWeight: tab === n.id ? 700 : 500, fontFamily: FONT_SANS,
              }}
            >
              <n.icon size={15} color={tab === n.id ? COLORS.amber : COLORS.faint} />
              {n.label}
              {n.id === "jobcards" && overdueJobs.length > 0 && (role === "admin" || role === "frontdesk") && (
                <span style={{ marginLeft: "auto", fontSize: 10, background: COLORS.red, color: "#fff", borderRadius: 999, padding: "1px 6px", fontFamily: FONT_MONO }}>
                  {overdueJobs.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", background: COLORS.panel2, borderRadius: 8, marginBottom: 8 }}>
            <UserCircle2 size={20} color={COLORS.amber} />
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{roleLabel[role]}</div>
              <div style={{ fontSize: 10.5, color: COLORS.faint }}>{roleSub[role]}</div>
            </div>
          </div>
          {requiresClockIn && myOpenAttendance && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, color: COLORS.teal, marginBottom: 8, padding: "0 2px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><CircleDot size={10} /> On shift</span>
              <span style={{ fontFamily: FONT_MONO }}>{timeAgo(myOpenAttendance.clockIn, tick)}</span>
            </div>
          )}
          {requiresClockIn && myOpenAttendance && (
            <Btn
              variant="outline" size="sm" style={{ width: "100%", marginBottom: 8 }} disabled={clockingIn}
              onClick={() => clockOut(myOpenAttendance.id)}
            >
              <Clock size={13} /> {clockingIn ? "Capturing location…" : "Clock Out"}
            </Btn>
          )}
          <Btn variant="ghost" size="sm" style={{ width: "100%" }} onClick={() => { setRole(null); setActiveTechId(null); }}>
            <LogOut size={13} /> Switch role
          </Btn>
        </div>
      </div>

      <div className={`sidebar-overlay${mobileNavOpen ? " open" : ""}`} onClick={() => setMobileNavOpen(false)} />

      {/* ---------------- MAIN ---------------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          role={role}
          overdueCount={visibleOverdueJobs.length}
          lastRefresh={lastRefresh}
          tick={tick}
          showAlerts={showAlerts}
          setShowAlerts={setShowAlerts}
          overdueJobs={visibleOverdueJobs}
          reminders={visibleReminders}
          jobs={jobs}
          technicians={technicians}
          onAssignTech={(role === "admin" || role === "frontdesk") ? assignTech : null}
          onRequestFeedback={(role === "admin" || role === "frontdesk") ? (jobId) => requestJobUpdate(jobId, roleLabel[role] || "Office") : null}
          onSendWhatsApp={sendWhatsAppUpdate}
          onSendSms={sendSmsUpdate}
          onCall={callReminder}
          onDismissReminder={isTechRole ? dismissTechReminder : dismissReminder}
          repairAlerts={(role === "admin" || role === "frontdesk") ? repairAlerts : []}
          onReviewRepairRequest={(jobId, estimate, serviceCharge) => reviewRepairRequest(jobId, estimate, serviceCharge, roleLabel[role] || "Office")}
          onConfirmCustomerApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
          onDeclineCustomerApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
          onManualRefresh={() => {
            setLastRefresh(Date.now());
            pushToast(`Dashboard refreshed manually. ${visibleOverdueJobs.length} order(s) need attention.`, "alert");
          }}
          onOpenNav={() => setMobileNavOpen(true)}
          onSimulateCall={(role === "admin" || role === "frontdesk") ? () => setSimulatingCall(true) : null}
        />

        <div className="main-scroll" style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {tab === "dashboard" && role === "admin" && (
            <Dashboard
              jobs={jobs} invoices={invoices} technicians={technicians} parts={parts}
              revenueToday={revenueToday} outstandingDues={outstandingDues} pendingOrders={pendingOrders}
              liveLocations={liveLocations} tick={tick}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: roleLabel[role] || "Office" })}
              onAssignTech={assignTech}
              onWhatsApp={sendWhatsAppToJob}
              onSms={sendSmsToJob}
              onCall={callJob}
              onPrint={setPrintInvoice}
              onConfirmApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
              onDeclineApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
              onViewLiveTracking={() => setTab("livetracking")}
              smsLog={smsLog}
              labelPrintEnforced={notificationSettings.labelPrintEnforcement?.enabled}
              standbyLoans={standbyLoans}
              onGiveStandby={setGivingStandbyFor}
              onMarkStandbyReturned={markStandbyReturned}
            />
          )}

          {tab === "dashboard" && role === "frontdesk" && (
            <FrontDeskDashboard
              jobs={jobs} technicians={technicians} tick={tick} parts={parts}
              liveLocations={liveLocations}
              onAssign={assignTech} onPrintLabel={setPrintJob}
              onSms={sendSmsToJob}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: roleLabel[role] || "Office" })}
              onWhatsApp={sendWhatsAppToJob}
              onCall={callJob}
              onConfirmApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
              onDeclineApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
              onViewLiveTracking={() => setTab("livetracking")}
              smsLog={smsLog}
              labelPrintEnforced={notificationSettings.labelPrintEnforcement?.enabled}
              standbyLoans={standbyLoans}
              onGiveStandby={setGivingStandbyFor}
              onMarkStandbyReturned={markStandbyReturned}
            />
          )}

          {tab === "dashboard" && (role === "indoor_tech" || role === "outdoor_tech") && (
            <TechnicianDashboard
              role={role} tech={techMap[activeTechId]}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onMyJobs={() => setTab("myjobs")}
              extraTasks={extraTasks.filter((t) => t.techId === activeTechId)}
              onCompleteExtraWork={(taskId) => completeExtraWork(taskId, techMap[activeTechId]?.name || "Technician")}
            />
          )}

          {tab === "myjobs" && role === "indoor_tech" && (
            <MyJobsView
              jobs={jobs.filter((j) => j.assignedTech === activeTechId)} tick={tick}
              onSubmitRepairReport={(jobId, status, remarks, fault, subFaults) => submitRepairReport(jobId, status, remarks, techMap[activeTechId]?.name || "Technician", fault, subFaults)}
              onRequestReassignment={(jobId, reason) => requestReassignment(jobId, reason, activeTechId)}
            />
          )}

          {tab === "newjob" && (
            <NewJobForm
              presetCustomer={newJobPreset}
              customers={customers}
              jobs={jobs}
              onSms={sendSmsToJob}
              onWhatsApp={sendWhatsAppToJob}
              onCreate={(data) => {
                const isTech = role === "indoor_tech" || role === "outdoor_tech";
                const creator = isTech
                  ? { role, label: techMap[activeTechId]?.name || (role === "indoor_tech" ? "Indoor Technician" : "Outdoor Technician"), techId: activeTechId }
                  : { role, label: role === "admin" ? "Admin" : "Front Desk", techId: null };
                const j = createJob(data, creator);
                pushToast(`Job card ${j.id} created for ${j.customer}.`, "ok");
                setNewJobPreset(null);
                setTab(isTech ? "dashboard" : newJobPreset ? "customers" : "jobcards");
                if (!isTech) setPostCreateJobPopup(j);
              }}
            />
          )}

          {tab === "customers" && (
            <CustomersView
              customers={customers} jobs={jobs} tick={tick} role={role}
              onLogCall={createCustomer}
              onAddNote={(customerId, note) => addCustomerNote(customerId, note, roleLabel[role] || "Office")}
              onCreateJob={(customer) => { setNewJobPreset(customer); setTab("newjob"); }}
              onWhatsApp={sendWhatsAppToCustomer}
              onSms={sendSmsToCustomer}
              onCall={callCustomer}
              onRequestDelete={setConfirmDeleteCustomer}
              onUpdateLocation={(customerId, loc) => updateCustomer(customerId, { currentLocation: loc })}
              smsLog={smsLog}
            />
          )}

          {tab === "jobcards" && (
            <JobCardsList
              jobs={jobs} technicians={technicians} role={role} tick={tick}
              onPrintLabel={setPrintJob}
              onAssign={assignTech}
              onSms={sendSmsToJob}
              onWhatsApp={sendWhatsAppToJob}
              onCall={callJob}
              onRequestDelete={setConfirmDeleteJob}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: roleLabel[role] || "Office" })}
              onConfirmApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
              onDeclineApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
              onRequestUpdate={(jobId) => requestJobUpdate(jobId, roleLabel[role] || "Office")}
              parts={parts}
              smsLog={smsLog}
              labelPrintEnforced={notificationSettings.labelPrintEnforcement?.enabled}
              standbyLoans={standbyLoans}
              onGiveStandby={setGivingStandbyFor}
              onMarkStandbyReturned={markStandbyReturned}
            />
          )}

          {tab === "billing" && (
            <Billing
              jobs={jobs} invoices={invoices} parts={parts} role={role}
              onCreateInvoice={createInvoice} onMarkPaid={markInvoicePaid}
              onPrint={setPrintInvoice} revenueToday={revenueToday} outstandingDues={outstandingDues}
            />
          )}

          {tab === "standby" && (role === "admin" || role === "frontdesk") && (
            <StandbyTvView loans={standbyLoans} jobs={jobs} tick={tick} onMarkReturned={markStandbyReturned} />
          )}

          {tab === "inventory" && <Inventory parts={parts} setParts={setParts} />}

          {tab === "technicians" && (role === "admin" || role === "frontdesk") && (
            <TechniciansView
              technicians={technicians} setTechnicians={setTechnicians} jobs={jobs} role={role}
              onRequestDelete={setConfirmDeleteTech}
              extraTasks={extraTasks} onAssignExtraWork={assignExtraWork}
              onCompleteExtraWork={(taskId) => completeExtraWork(taskId, roleLabel[role] || "Office")}
              onDeleteExtraWork={deleteExtraWork}
            />
          )}

          {tab === "reports" && (role === "admin" || role === "frontdesk") && (
            <ReportsView technicians={technicians} jobs={jobs} invoices={invoices} extraTasks={extraTasks} />
          )}

          {tab === "sms" && <SmsLogView log={smsLog} />}

          {tab === "attendance" && <AttendanceView attendance={attendance} tick={tick} />}
          {tab === "livetracking" && (role === "admin" || role === "frontdesk") && (
            <LiveTrackingView technicians={technicians} attendance={attendance} liveLocations={liveLocations} tick={tick} />
          )}

          {tab === "settings" && role === "admin" && (
            <SettingsView
              smsDispatchMode={smsDispatchMode} setSmsDispatchMode={setSmsDispatchMode}
              notificationSettings={notificationSettings} setNotificationSettings={setNotificationSettings}
              loginWindowSettings={loginWindowSettings} setLoginWindowSettings={setLoginWindowSettings}
            />
          )}
        </div>
      </div>

      {confirmDeleteJob && (
        <Modal title="Delete Job Card" onClose={() => setConfirmDeleteJob(null)} width={420}>
          <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6 }}>
            Permanently delete <strong style={{ fontFamily: FONT_MONO }}>{confirmDeleteJob.id}</strong> for{" "}
            <strong>{confirmDeleteJob.customer}</strong>? This also removes any invoice linked to this job.
            This action cannot be undone.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <Btn variant="danger" style={{ borderColor: COLORS.red, background: COLORS.redDim }}
              onClick={() => { deleteJob(confirmDeleteJob.id); setConfirmDeleteJob(null); }}>
              <Trash2 size={14} /> Delete Permanently
            </Btn>
            <Btn variant="outline" onClick={() => setConfirmDeleteJob(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {confirmDeleteTech && (
        <Modal title="Remove Technician" onClose={() => setConfirmDeleteTech(null)} width={420}>
          <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6 }}>
            Remove <strong>{confirmDeleteTech.name}</strong> from technicians?
            {jobs.some((j) => j.assignedTech === confirmDeleteTech.id && j.status !== "delivered") && (
              <>
                {" "}They have{" "}
                <strong style={{ color: COLORS.amber }}>
                  {jobs.filter((j) => j.assignedTech === confirmDeleteTech.id && j.status !== "delivered").length} active job(s)
                </strong>{" "}
                assigned — those will be unassigned so they can be picked up by someone else.
              </>
            )}
            {" "}This action cannot be undone.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <Btn variant="danger" style={{ borderColor: COLORS.red, background: COLORS.redDim }}
              onClick={() => { deleteTechnician(confirmDeleteTech.id); setConfirmDeleteTech(null); }}>
              <Trash2 size={14} /> Remove Technician
            </Btn>
            <Btn variant="outline" onClick={() => setConfirmDeleteTech(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {confirmDeleteCustomer && (
        <Modal title="Delete Customer (CID)" onClose={() => setConfirmDeleteCustomer(null)} width={420}>
          <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6 }}>
            Permanently delete <strong style={{ fontFamily: FONT_MONO }}>{confirmDeleteCustomer.customerId}</strong>
            {confirmDeleteCustomer.name ? <> for <strong>{confirmDeleteCustomer.name}</strong></> : ""}?
            {jobs.some((j) => j.customerId === confirmDeleteCustomer.customerId) && (
              <>
                {" "}This CID has{" "}
                <strong style={{ color: COLORS.amber }}>
                  {jobs.filter((j) => j.customerId === confirmDeleteCustomer.customerId).length} linked job(s)
                </strong>{" "}
                — those job cards stay in the system, they just won't show a linked CID anymore.
              </>
            )}
            {" "}This action cannot be undone.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <Btn variant="danger" style={{ borderColor: COLORS.red, background: COLORS.redDim }}
              onClick={() => { deleteCustomer(confirmDeleteCustomer.customerId); setConfirmDeleteCustomer(null); }}>
              <Trash2 size={14} /> Delete Permanently
            </Btn>
            <Btn variant="outline" onClick={() => setConfirmDeleteCustomer(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {jobPromptCustomer && jobPromptCustomer.customerType !== "outdoor" && !holdPopupsForNewJob && (
        <Modal title="Create Job ID Now?" onClose={() => setJobPromptCustomer(null)} width={400}>
          <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6, marginBottom: 20 }}>
            <strong style={{ fontFamily: FONT_MONO }}>{jobPromptCustomer.customerId}</strong> has been saved
            {jobPromptCustomer.name ? <> for <strong>{jobPromptCustomer.name}</strong></> : ""}. Would you like to create a Job ID for this customer right now?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => { setNewJobPreset(jobPromptCustomer); setTab("newjob"); setJobPromptCustomer(null); }}>
              <Plus size={14} /> Yes, Create Job ID
            </Btn>
            <Btn variant="outline" onClick={() => setJobPromptCustomer(null)}>Not Now</Btn>
          </div>
        </Modal>
      )}

      {jobPromptCustomer && jobPromptCustomer.customerType === "outdoor" && !holdPopupsForNewJob && (
        <Modal title="Assign Outdoor Technician?" onClose={() => setJobPromptCustomer(null)} width={420}>
          <div style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.6, marginBottom: 20 }}>
            <strong style={{ fontFamily: FONT_MONO }}>{jobPromptCustomer.customerId}</strong> has been saved
            {jobPromptCustomer.name ? <> for <strong>{jobPromptCustomer.name}</strong></> : ""}. This is an outdoor/field customer — assign a technician for an on-site visit now?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="teal" onClick={() => { setAssigningOutdoorFor(jobPromptCustomer); setJobPromptCustomer(null); }}>
              <MapPin size={14} /> Assign Outdoor Technician
            </Btn>
            <Btn variant="outline" onClick={() => setJobPromptCustomer(null)}>Not Now</Btn>
          </div>
        </Modal>
      )}

      {assigningOutdoorFor && (
        <Modal title={`Assign Outdoor Technician — ${assigningOutdoorFor.customerId}`} onClose={() => setAssigningOutdoorFor(null)} width={540}>
          <AssignOutdoorTechForm
            customer={assigningOutdoorFor}
            technicians={technicians}
            jobs={jobs}
            attendance={attendance}
            onAssign={(techId, visitTime) => {
              const job = scheduleOutdoorVisit(assigningOutdoorFor, techId, visitTime, { role, label: roleLabel[role] || "Office" });
              pushToast(`${job.id} scheduled — ${techMap[techId]?.name || "technician"} notified for the field visit.`, "ok");
              setAssigningOutdoorFor(null);
            }}
            onCancel={() => setAssigningOutdoorFor(null)}
          />
        </Modal>
      )}

      {outdoorVisitRequestPopup && !holdPopupsForNewJob && (
        <Modal title={`New Field Visit — Job #${outdoorVisitRequestPopup.id}`} onClose={() => {}} width={440}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 9 }}>
            <MapPin size={18} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              A new field visit has been scheduled for you — review the details and accept, or hand it back if you can't take it.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
            <div><span style={{ color: COLORS.faint }}>Customer:</span> {outdoorVisitRequestPopup.customer || "—"}</div>
            <div><span style={{ color: COLORS.faint }}>CID:</span> <span style={{ fontFamily: FONT_MONO }}>{outdoorVisitRequestPopup.customerId || "—"}</span></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Location:</span> {outdoorVisitRequestPopup.location || "—"}</div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Estimated Visit Time:</span> <strong>{outdoorVisitRequestPopup.estimatedVisitTime}</strong></div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={() => { acceptOutdoorVisit(outdoorVisitRequestPopup.id); setOutdoorVisitRequestPopup(null); }}>
              <CheckCircle2 size={14} /> Accept
            </Btn>
            <Btn
              variant="danger"
              onClick={() => { requestReassignment(outdoorVisitRequestPopup.id, "Unable to take this field visit", activeTechId); setOutdoorVisitRequestPopup(null); }}
            >
              <AlertTriangle size={14} /> Can't Take This — Hand Back
            </Btn>
          </div>
        </Modal>
      )}

      {upcomingVisitPopup && !holdPopupsForNewJob && (
        <Modal title={`Upcoming Visit — Job #${upcomingVisitPopup.id}`} onClose={() => setUpcomingVisitPopup(null)} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <Clock size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              Your field visit is coming up in about 30 minutes — estimated time: <strong>{upcomingVisitPopup.estimatedVisitTime}</strong>.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
            <div><span style={{ color: COLORS.faint }}>Customer:</span> {upcomingVisitPopup.customer || "—"}</div>
            <div><span style={{ color: COLORS.faint }}>CID:</span> <span style={{ fontFamily: FONT_MONO }}>{upcomingVisitPopup.customerId || "—"}</span></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Location:</span> {upcomingVisitPopup.location || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn variant="outline" onClick={() => { window.location.href = telLink(upcomingVisitPopup.phone); }}>
              <Phone size={14} /> Call Customer
            </Btn>
            <Btn onClick={() => setUpcomingVisitPopup(null)}>
              <CheckCircle2 size={14} /> Acknowledge
            </Btn>
          </div>
        </Modal>
      )}

      {labelPrintReminderPopup && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal title="Label Not Printed" onClose={() => dismissLabelPrintReminder(labelPrintReminderPopup)} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <Printer size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              Label not printed for TV <strong style={{ fontFamily: FONT_MONO }}>{labelPrintReminderPopup.jobId}</strong> — {labelPrintReminderPopup.brand} {labelPrintReminderPopup.model} for {labelPrintReminderPopup.customer || "the customer"}.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Btn onClick={() => printLabelReminderNow(labelPrintReminderPopup)}>
              <Printer size={14} /> Print Label Now
            </Btn>
            <Btn variant="outline" onClick={() => snoozeLabelPrintReminder(labelPrintReminderPopup)}>
              <Clock size={14} /> Remind Me Later (10 min)
            </Btn>
            <Btn variant="outline" onClick={() => dismissLabelPrintReminder(labelPrintReminderPopup)}>
              <X size={14} /> Dismiss
            </Btn>
          </div>
        </Modal>
      )}


      {standbyTvReminderPopup && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal title="Standby TV Due Back" onClose={() => snoozeStandbyReminder(standbyTvReminderPopup)} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <Tv size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              The {standbyTvReminderPopup.days}-day standby period is up for <strong style={{ fontFamily: FONT_MONO }}>{standbyTvReminderPopup.jobId}</strong> — {standbyTvReminderPopup.tvGiven || "standby unit"} given to {standbyTvReminderPopup.customer || "the customer"}. Time to collect it back.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Btn onClick={() => markStandbyReturned(standbyTvReminderPopup.id)}>
              <CheckCircle2 size={14} /> Mark Returned
            </Btn>
            <Btn variant="outline" onClick={() => snoozeStandbyReminder(standbyTvReminderPopup)}>
              <Clock size={14} /> Remind Me Later ({(notificationSettings.standbyTv || {}).snoozeMin || 60} min)
            </Btn>
          </div>
        </Modal>
      )}

      {givingStandbyFor && (
        <Modal title={`Give Standby TV — ${givingStandbyFor.id}`} onClose={() => setGivingStandbyFor(null)} width={440}>
          <GiveStandbyTvForm
            job={givingStandbyFor}
            onSave={(form) => giveStandbyTv(givingStandbyFor, form, roleLabel[role] || "Office")}
          />
        </Modal>
      )}


      {techFollowupPopup && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal title={`Technician Follow-Up — Job #${techFollowupPopup.id}`} onClose={() => setTechFollowupPopup(null)} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <RefreshCw size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              <strong>{techMap[techFollowupPopup.assignedTech]?.name || "The technician"}</strong>'s field visit for <strong style={{ fontFamily: FONT_MONO }}>{techFollowupPopup.id}</strong> is due in about 30 minutes ({techFollowupPopup.estimatedVisitTime}) — worth a quick check-in to confirm they're on track.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
            <div><span style={{ color: COLORS.faint }}>Customer:</span> {techFollowupPopup.customer || "—"}</div>
            <div><span style={{ color: COLORS.faint }}>CID:</span> <span style={{ fontFamily: FONT_MONO }}>{techFollowupPopup.customerId || "—"}</span></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Location:</span> {techFollowupPopup.location || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {techMap[techFollowupPopup.assignedTech]?.phone && (
              <Btn variant="outline" onClick={() => { window.location.href = telLink(techMap[techFollowupPopup.assignedTech].phone); }}>
                <Phone size={14} /> Call Technician
              </Btn>
            )}
            <Btn onClick={() => setTechFollowupPopup(null)}>
              <CheckCircle2 size={14} /> Dismiss
            </Btn>
          </div>
        </Modal>
      )}

      {postCreateJobPopup && !holdPopupsForNewJob && (
        <Modal title={`Job Card Created — ${postCreateJobPopup.id}`} onClose={() => setPostCreateJobPopup(null)} width={440}>
          <JobCreatedPopupBody
            job={postCreateJobPopup}
            technicians={technicians}
            onPrintLabel={(j) => { setPrintJob(j); setPostCreateJobPopup(null); }}
            onAssign={(techId) => {
              assignTech(postCreateJobPopup.id, techId);
              pushToast(`${postCreateJobPopup.id} assigned to ${techMap[techId]?.name || "technician"}.`, "ok");
              setPostCreateJobPopup(null);
            }}
            onAssignLater={() => {
              pushToast(`${postCreateJobPopup.id} left unassigned — you'll get a reminder every 30 minutes until a technician is assigned.`, "alert");
              setPostCreateJobPopup(null);
            }}
          />
        </Modal>
      )}

      {unassignedReminderPopup && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal title={`Technician Needed — Job #${unassignedReminderPopup.jobId}`} onClose={() => setUnassignedReminderPopup(null)} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <AlertTriangle size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              Job <strong style={{ fontFamily: FONT_MONO }}>{unassignedReminderPopup.jobId}</strong> ({unassignedReminderPopup.brand} {unassignedReminderPopup.model}) still has no technician assigned — {unassignedReminderPopup.stage * 30} minute{unassignedReminderPopup.stage > 1 ? "s" : ""} and counting.
            </div>
          </div>
          <AssignTechInline
            technicians={technicians}
            techType={unassignedReminderPopup.jobType === "outdoor" ? "outdoor" : "indoor"}
            onAssign={(techId) => {
              assignTech(unassignedReminderPopup.jobId, techId);
              pushToast(`${unassignedReminderPopup.jobId} assigned to ${techMap[techId]?.name || "technician"}.`, "ok");
              setUnassignedReminderPopup(null);
            }}
            onCancel={() => setUnassignedReminderPopup(null)}
            cancelLabel="Dismiss — remind me later"
          />
        </Modal>
      )}

      {simulatingCall && (
        <Modal title="Simulate Incoming Call" onClose={() => setSimulatingCall(false)} width={380}>
          <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 14, lineHeight: 1.5 }}>
            A real deployment reads this from the phone's caller ID automatically (via a native Android call-screening
            service) — type a number here to test how the popup behaves.
          </div>
          <SimulateCallForm onTrigger={(phone) => {
            setIncomingCallPhone(phone);
            setSimulatingCall(false);
            appendSmsLog({ ts: Date.now(), phone, jobId: null, message: `[Call] Incoming call from ${phone}.` });
          }} />
        </Modal>
      )}

      {incomingCallPhone && (
        <Modal title="Incoming Call" onClose={() => setIncomingCallPhone(null)} width={420}>
          <IncomingCallPopup
            phone={incomingCallPhone}
            customer={findCustomerByPhone(incomingCallPhone)}
            jobs={jobs}
            onClose={() => setIncomingCallPhone(null)}
            onCreateCustomer={(data) => { createCustomer(data); setIncomingCallPhone(null); }}
            onCall={() => { window.location.href = telLink(incomingCallPhone); }}
            onViewCustomer={(customer) => { setIncomingCallPhone(null); setTab("customers"); }}
            onCreateJob={(customer) => { setIncomingCallPhone(null); setNewJobPreset(customer); setTab("newjob"); }}
          />
        </Modal>
      )}

      {!isTechRole && visiblePopupReminder && !holdPopupsForNewJob && (
        <Modal title={`2-Hour Reminder — Job #${visiblePopupReminder.jobId}`} onClose={() => setPopupReminder(null)} width={440}>
          <ReminderPopupBody
            reminder={visiblePopupReminder}
            jobs={jobs}
            technicians={technicians}
            onAssignTech={(role === "admin" || role === "frontdesk") ? assignTech : null}
            onRequestFeedback={(role === "admin" || role === "frontdesk") ? (jobId) => requestJobUpdate(jobId, roleLabel[role] || "Office") : null}
            onSendWhatsApp={(statusLabel, days, reason, customReason, otherSubStatus) => sendWhatsAppUpdate(visiblePopupReminder, statusLabel, days, reason, customReason, otherSubStatus)}
            onSendSms={(statusLabel, days, reason, customReason, otherSubStatus) => sendSmsUpdate(visiblePopupReminder, statusLabel, days, reason, customReason, otherSubStatus)}
            onCall={() => callReminder(visiblePopupReminder)}
            onClose={() => setPopupReminder(null)}
          />
        </Modal>
      )}

      {isTechRole && visiblePopupReminder && !holdPopupsForNewJob && (
        <Modal title={`1-Hour Reminder — Job #${visiblePopupReminder.jobId}`} onClose={() => dismissTechReminder(visiblePopupReminder.id)} width={400}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <Clock size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              This job has been with you for over {visiblePopupReminder.stage}h without an update. Please check it and submit a status update.
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 16 }}>{visiblePopupReminder.brand} {visiblePopupReminder.model} — <Badge status={visiblePopupReminder.status} /></div>
          <Btn onClick={() => dismissTechReminder(visiblePopupReminder.id)}>
            <CheckCircle2 size={14} /> Acknowledge
          </Btn>
        </Modal>
      )}

      {confirmedRepairPopup && !holdPopupsForNewJob && (
        <Modal title="Customer Approved — Proceed with Repair" onClose={() => {}} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 9 }}>
            <CheckCircle2 size={18} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              The customer has confirmed they're OK with the repair on <strong style={{ fontFamily: FONT_MONO }}>{confirmedRepairPopup.id}</strong>. You're clear to proceed.
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 4 }}>{confirmedRepairPopup.brand} {confirmedRepairPopup.model}</div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 16 }}>{confirmedRepairPopup.issue}</div>
          <Btn onClick={() => { acknowledgeRepairConfirmation(confirmedRepairPopup.id); setConfirmedRepairPopup(null); }}>
            <CheckCircle2 size={14} /> Acknowledge &amp; Proceed
          </Btn>
        </Modal>
      )}

      {declinedRepairPopup && !holdPopupsForNewJob && (
        <Modal title="Customer Did Not Approve — Return TV" onClose={() => {}} width={420}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.redDim, border: `1px solid ${COLORS.red}55`, borderRadius: 9 }}>
            <X size={18} color={COLORS.red} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              The customer did not approve the repair on <strong style={{ fontFamily: FONT_MONO }}>{declinedRepairPopup.id}</strong>. Please pack up the TV for return — no repair needed.
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 4 }}>{declinedRepairPopup.brand} {declinedRepairPopup.model}</div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 16 }}>{declinedRepairPopup.issue}</div>
          <Btn variant="danger" style={{ borderColor: COLORS.red, background: COLORS.redDim }} onClick={() => { acknowledgeRepairDecline(declinedRepairPopup.id); setDeclinedRepairPopup(null); }}>
            <X size={14} /> Acknowledge
          </Btn>
        </Modal>
      )}

      {activeRepairRequestPopup && !holdPopupsForNewJob && (
        <Modal
          title={`Repair Status Update — Job #${activeRepairRequestPopup.id}${repairRequestQueue.length > 0 ? ` (1 of ${repairRequestQueue.length + 1})` : ""}`}
          onClose={() => {}}
          width={460}
        >
          <RepairRequestPopupBody
            job={activeRepairRequestPopup}
            onReview={(jobId, estimate, serviceCharge) => {
              reviewRepairRequest(jobId, estimate, serviceCharge, roleLabel[role] || "Office");
              setActiveRepairRequestPopup(null);
            }}
          />
        </Modal>
      )}

      {activeReassignmentPopup && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal
          title={`Reassign Technician — Job #${activeReassignmentPopup.id}${reassignmentQueue.length > 0 ? ` (1 of ${reassignmentQueue.length + 1})` : ""}`}
          onClose={() => setActiveReassignmentPopup(null)}
          width={440}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.redDim, border: `1px solid ${COLORS.red}55`, borderRadius: 9 }}>
            <AlertTriangle size={18} color={COLORS.red} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              <strong style={{ fontFamily: FONT_MONO }}>{activeReassignmentPopup.id}</strong> ({activeReassignmentPopup.brand} {activeReassignmentPopup.model}) was handed back by the assigned technician
              {activeReassignmentPopup.reassignmentReason ? <> — <em>"{activeReassignmentPopup.reassignmentReason}"</em></> : "."} Please assign it to another technician.
            </div>
          </div>
          <AssignTechInline
            technicians={technicians}
            techType={activeReassignmentPopup.jobType === "outdoor" ? "outdoor" : "indoor"}
            onAssign={(techId) => {
              reassignJob(activeReassignmentPopup.id, techId, roleLabel[role] || "Office");
              pushToast(`${activeReassignmentPopup.id} reassigned to ${techMap[techId]?.name || "technician"}.`, "ok");
              setActiveReassignmentPopup(null);
            }}
            onCancel={() => setActiveReassignmentPopup(null)}
            cancelLabel="Dismiss — assign later"
          />
        </Modal>
      )}

      {techUpdateRequestPopup && !holdPopupsForNewJob && (
        <Modal title={`Status Update Requested — Job #${techUpdateRequestPopup.id}`} onClose={() => {}} width={460}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
            <RefreshCw size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
              Front Desk/Admin has asked for a current status update on this job — submit one below.
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 14 }}>{techUpdateRequestPopup.brand} {techUpdateRequestPopup.model} — {techUpdateRequestPopup.issue}</div>
          <TechUpdateRequestForm
            job={techUpdateRequestPopup}
            onSubmit={(status, note) => {
              submitJobUpdateResponse(techUpdateRequestPopup.id, status, note, techMap[activeTechId]?.name || "Technician");
              setTechUpdateRequestPopup(null);
            }}
          />
        </Modal>
      )}

      {activeTechUpdateFeedback && (role === "admin" || role === "frontdesk") && !holdPopupsForNewJob && (
        <Modal
          title={`Technician Update — Job #${activeTechUpdateFeedback.id}${techUpdateFeedbackQueue.length > 0 ? ` (1 of ${techUpdateFeedbackQueue.length + 1})` : ""}`}
          onClose={() => { dismissJobUpdateFeedback(activeTechUpdateFeedback.id); setActiveTechUpdateFeedback(null); }}
          width={460}
        >
          <TechUpdateFeedbackBody
            job={activeTechUpdateFeedback}
            onSend={(channel, message) => sendJobUpdateToCustomer(activeTechUpdateFeedback.id, channel, message)}
            onDone={() => { dismissJobUpdateFeedback(activeTechUpdateFeedback.id); setActiveTechUpdateFeedback(null); }}
          />
        </Modal>
      )}

      {addingCustomer && (
        <Modal title="Add Customer" onClose={() => setAddingCustomer(false)} width={440}>
          <LogCallForm
            customers={customers}
            jobs={jobs}
            smsLog={smsLog}
            onSubmit={(data) => { createCustomer(data); setAddingCustomer(false); }}
            onCancel={() => setAddingCustomer(false)}
            onCreateJob={(customer) => { setNewJobPreset(customer); setTab("newjob"); setAddingCustomer(false); }}
            onViewCustomer={() => { setTab("customers"); setAddingCustomer(false); }}
          />
        </Modal>
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  ROLE SELECT SCREEN                                                     */
/* ---------------------------------------------------------------------- */
function RoleSelect({ technicians, onSelect, loginWindowSettings = DEFAULT_LOGIN_WINDOW_SETTINGS }) {
  const [pickingRole, setPickingRole] = useState(null); // null | "indoor_tech" | "outdoor_tech"
  useBackClose("pickingRole", !!pickingRole, () => setPickingRole(null));
  const techTypeLabel = { indoor_tech: "Indoor Technician", outdoor_tech: "Outdoor Technician" };
  const filteredTechs = pickingRole
    ? technicians.filter((t) => t.type === (pickingRole === "indoor_tech" ? "indoor" : "outdoor"))
    : [];

  return (
    <div style={{
      fontFamily: FONT_SANS,
      background: `
        radial-gradient(circle at 12% 12%, rgba(255,255,255,0.55), transparent 38%),
        radial-gradient(circle at 88% 22%, rgba(147,197,253,0.55), transparent 45%),
        radial-gradient(circle at 25% 88%, rgba(244,114,182,0.5), transparent 50%),
        radial-gradient(circle at 78% 82%, rgba(196,181,253,0.55), transparent 45%),
        linear-gradient(135deg, #a78bfa 0%, #f0abfc 30%, #93c5fd 65%, #f9a8d4 100%)
      `,
      color: "#2B1A4A", minHeight: 620, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: 14, border: "1px solid rgba(255,255,255,0.5)", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 8px 20px rgba(240,166,58,0.4)" }}>
            <Tv size={28} color="#1A1300" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 21, color: "#fff", textShadow: "0 2px 14px rgba(80,20,120,0.35)" }}>AitechLab CRM</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: FONT_MONO, letterSpacing: 1, marginTop: 2, textShadow: "0 1px 8px rgba(80,20,120,0.3)" }}>LED TV REPAIR SERVICE CENTER</div>
        </div>

        {!pickingRole ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { id: "admin", icon: LayoutDashboard, title: "Admin", desc: "Dashboard, billing, inventory, all job cards" },
              { id: "frontdesk", icon: ClipboardList, title: "Front Desk", desc: "Intake, job cards, print labels, SMS" },
              { id: "indoor_tech", icon: Wrench, title: "Indoor Technician", desc: "Bench repairs — add new jobs on the spot" },
              { id: "outdoor_tech", icon: MapPin, title: "Outdoor Technician", desc: "Field visits — add new jobs on the spot" },
            ].map((r) => {
              const isTechRole = r.id === "indoor_tech" || r.id === "outdoor_tech";
              const winCfg = loginWindowSettings[r.id] || DEFAULT_LOGIN_WINDOW_SETTINGS[r.id];
              const locked = isTechRole && !isWithinLoginWindow(winCfg);
              return (
                <button
                  key={r.id}
                  disabled={locked}
                  onClick={() => (isTechRole ? setPickingRole(r.id) : onSelect(r.id))}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "16px 16px", borderRadius: 11,
                    background: locked ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.85)", backdropFilter: "blur(10px)",
                    border: "1px solid rgba(255,255,255,0.7)", cursor: locked ? "not-allowed" : "pointer", textAlign: "left",
                    boxShadow: "0 8px 22px rgba(80,20,120,0.18)", opacity: locked ? 0.65 : 1,
                  }}
                  onMouseEnter={(e) => !locked && (e.currentTarget.style.borderColor = "#a78bfa")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.7)")}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(139,92,246,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {locked ? <Clock size={19} color="#7C3AED" /> : <r.icon size={19} color="#7C3AED" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: "#2B1A4A" }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: "#6B5B8A", marginTop: 1 }}>
                      {locked ? `Locked until ${fmtHHMMDisplay(winCfg.start)} — access ends daily at ${fmtHHMMDisplay(winCfg.end)}` : r.desc}
                    </div>
                  </div>
                  <ChevronRight size={17} color="#9B8AB5" />
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <button onClick={() => setPickingRole(null)} style={{ background: "none", border: "none", color: "#fff", textShadow: "0 1px 8px rgba(80,20,120,0.3)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 14, fontSize: 12.5 }}>
              <ArrowLeft size={14} /> Back
            </button>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", textShadow: "0 1px 8px rgba(80,20,120,0.3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
              Select {techTypeLabel[pickingRole].toLowerCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredTechs.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#fff", textShadow: "0 1px 8px rgba(80,20,120,0.3)", padding: "10px 2px" }}>
                  No {techTypeLabel[pickingRole].toLowerCase()}s set up yet — add one from the Technicians tab as Admin.
                </div>
              )}
              {filteredTechs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelect(pickingRole, t.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 10,
                    background: "rgba(255,255,255,0.85)", backdropFilter: "blur(10px)",
                    border: "1px solid rgba(255,255,255,0.7)", cursor: "pointer", textAlign: "left",
                    boxShadow: "0 8px 22px rgba(80,20,120,0.18)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = COLORS.teal)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.7)")}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700, fontSize: 13 }}>
                    {t.name.split(" ").map((x) => x[0]).join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: "#2B1A4A" }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: "#6B5B8A" }}>{t.specialty}</div>
                  </div>
                  <ChevronRight size={16} color="#9B8AB5" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  TOP BAR                                                                 */
/* ---------------------------------------------------------------------- */
function TopBar({ role, overdueCount, lastRefresh, tick, showAlerts, setShowAlerts, overdueJobs, reminders, jobs, technicians, onAssignTech, onRequestFeedback, onSendWhatsApp, onSendSms, onCall, onDismissReminder, repairAlerts = [], onReviewRepairRequest, onConfirmCustomerApproval, onDeclineCustomerApproval, onManualRefresh, onOpenNav, onSimulateCall }) {
  const titles = { admin: "Dashboard", frontdesk: "Front Desk", indoor_tech: "Indoor Technician", outdoor_tech: "Outdoor Technician" };
  const reminderCount = reminders.length + repairAlerts.length;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px", borderBottom: `1px solid ${COLORS.glassBorder}`,
      background: COLORS.glass, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
      gap: 10, flexWrap: "wrap", position: "relative", zIndex: 60,
    }}>
      <style>{`
        @keyframes bellPulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0 ${COLORS.red}FF; }
          70%  { transform: scale(1.12); box-shadow: 0 0 0 8px ${COLORS.red}00; }
          100% { transform: scale(1);    box-shadow: 0 0 0 0 ${COLORS.red}00; }
        }
        .bell-badge-pulse { animation: bellPulse 1.4s ease-in-out infinite; }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          className="hamburger-btn"
          onClick={onOpenNav}
          style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, cursor: "pointer", padding: 7, alignItems: "center", justifyContent: "center" }}
        >
          <Menu size={17} />
        </button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{titles[role]}</div>
          <div style={{ fontSize: 11, color: COLORS.faint, fontFamily: FONT_MONO }}>
            Auto-refresh every 30s · last sync {timeAgo(lastRefresh, tick)}
          </div>
        </div>
      </div>
      <div className="topbar-actions" style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        {onSimulateCall && (
          <Btn variant="outline" size="sm" onClick={onSimulateCall} title="Simulate an incoming call to test the caller-ID popup">
            <Phone size={13} /> Incoming Call
          </Btn>
        )}
        <Btn variant="outline" size="sm" onClick={onManualRefresh}>
          <RefreshCw size={13} /> Refresh
        </Btn>
        <button
          onClick={() => setShowAlerts((s) => !s)}
          style={{
            position: "relative", width: 34, height: 34, borderRadius: 9, background: COLORS.panel2,
            border: `1px solid ${COLORS.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Bell size={15} color={overdueCount || reminderCount ? COLORS.amber : COLORS.faint} />
          {(reminderCount > 0 || overdueCount > 0) && (
            <span
              className={reminderCount > 0 ? "bell-badge-pulse" : ""}
              style={{
                position: "absolute", top: -4, right: -4, background: COLORS.red, color: "#fff",
                fontSize: 9.5, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
                display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_MONO, padding: "0 3px",
              }}
            >
              {reminderCount > 0 ? reminderCount : overdueCount}
            </span>
          )}
        </button>
        {showAlerts && (
          <div style={{
            position: "absolute", top: 42, right: 0, width: "min(330px, 90vw)",
            background: COLORS.glass2, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${COLORS.glassBorder}`, borderRadius: 10,
            boxShadow: `inset 0 1px 0 ${COLORS.glassHighlight}, 0 12px 30px rgba(0,0,0,0.4)`,
            zIndex: 1000, padding: 12, maxHeight: "70vh", overflowY: "auto",
          }}>
            {repairAlerts.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: COLORS.text, display: "flex", alignItems: "center", gap: 6 }}>
                  <Wrench size={12} color={COLORS.teal} /> Repair Requests
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {repairAlerts.map((j) => (
                    <RepairAlertRow key={j.id} job={j} onReview={onReviewRepairRequest} onConfirm={onConfirmCustomerApproval} onDecline={onDeclineCustomerApproval} />
                  ))}
                </div>
              </div>
            )}
            {reminderCount - repairAlerts.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: COLORS.text, display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={12} color={COLORS.amber} /> {role === "indoor_tech" || role === "outdoor_tech" ? "1-Hour Reminders" : "2-Hour Reminders"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(role === "indoor_tech" || role === "outdoor_tech")
                    ? reminders.map((r) => (
                        <TechReminderRow key={r.id} reminder={r} onDismiss={onDismissReminder} />
                      ))
                    : reminders.map((r) => (
                        <ReminderRow key={r.id} reminder={r} jobs={jobs} technicians={technicians} onAssignTech={onAssignTech} onRequestFeedback={onRequestFeedback} onSendWhatsApp={onSendWhatsApp} onSendSms={onSendSms} onCall={onCall} onDismiss={onDismissReminder} />
                      ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: COLORS.text }}>
              Overdue pending orders (&gt;2h)
            </div>
            {overdueJobs.length === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.faint }}>Nothing overdue — all clear.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 220, overflowY: "auto" }}>
                {overdueJobs.map((j) => (
                  <div key={j.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 6 }}>
                    <span style={{ color: COLORS.text, fontFamily: FONT_MONO }}>{j.id}</span>
                    <span style={{ color: COLORS.faint, textAlign: "right" }}>{j.customer} · {timeAgo(j.intake, tick)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  REMINDER ROW — one card per job inside the bell dropdown.              */
/*  Stage 1: initial fault-diagnosis prompt, single WhatsApp send button.  */
/*  Stage 2+: technician picks a current status, then sends the update.   */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  JOB CARD CREATED POPUP — auto-opened right after Admin/Front Desk      */
/*  saves a new job card. Lets them print the label and either assign an  */
/*  Indoor Technician right away or defer it — deferring hands off to the */
/*  30-min UNASSIGNED_TECH_REMINDER_INTERVAL_MS engine above, which keeps */
/*  nudging until someone assigns it.                                     */
/* ---------------------------------------------------------------------- */
function AssignTechInline({ technicians, onAssign, onCancel, cancelLabel = "Back", techType = "indoor" }) {
  const filteredTechs = technicians.filter((t) => t.type === techType);
  const [techId, setTechId] = useState("");
  return (
    <div style={{ marginTop: 12 }}>
      <Field label={`Select ${techType === "outdoor" ? "Outdoor" : "Indoor"} Technician`}>
        <Select value={techId} onChange={(e) => setTechId(e.target.value)}>
          <option value="">— Choose —</option>
          {filteredTechs.map((t) => (
            <option key={t.id} value={t.id}>{t.name} — {t.specialty}</option>
          ))}
        </Select>
      </Field>
      {filteredTechs.length === 0 && (
        <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 6 }}>No {techType} technicians on file yet.</div>
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <Btn disabled={!techId} onClick={() => onAssign(techId)}><CheckCircle2 size={13} /> Confirm Assignment</Btn>
        <Btn variant="outline" onClick={onCancel}>{cancelLabel}</Btn>
      </div>
    </div>
  );
}

function JobCreatedPopupBody({ job, technicians, onPrintLabel, onAssign, onAssignLater }) {
  const [assigning, setAssigning] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 9 }}>
        <CheckCircle2 size={18} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
          Job card <strong style={{ fontFamily: FONT_MONO }}>{job.id}</strong> has been saved for {job.customer}. Print the label and assign a technician now, or come back to it later.
        </div>
      </div>

      <Btn onClick={() => onPrintLabel(job)} style={{ marginBottom: 14 }}>
        <Printer size={14} /> Print Job Card Label
      </Btn>

      {!assigning ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="teal" onClick={() => setAssigning(true)}><Wrench size={13} /> Assign Indoor Technician</Btn>
          <Btn variant="outline" onClick={onAssignLater}><Clock size={13} /> Assign Later</Btn>
        </div>
      ) : (
        <AssignTechInline technicians={technicians} onAssign={onAssign} onCancel={() => setAssigning(false)} />
      )}
    </div>
  );
}

/* Scheduling an outdoor/field-visit technician for a COD customer. Shows
   each outdoor technician's current pending-call load (active jobs
   assigned) and, when the customer's GPS was captured, flags whichever
   technician's most recent clock-in location is geographically nearest —
   both signals Admin/Front Desk can use to pick the right person, plus a
   preferred "estimated visit time" slot for the customer. */
function AssignOutdoorTechForm({ customer, technicians, jobs, attendance, onAssign, onCancel }) {
  const [techId, setTechId] = useState("");
  const [visitTime, setVisitTime] = useState(VISIT_TIME_OPTIONS[0]);

  const outdoorTechs = technicians.filter((t) => t.type === "outdoor");

  const techInfo = outdoorTechs.map((t) => {
    const pendingCalls = jobs.filter((j) => j.assignedTech === t.id && ACTIVE_JOB_STATUSES.includes(j.status)).length;
    const lastAttendance = [...attendance]
      .filter((a) => a.userId === t.id && a.clockInLocation)
      .sort((a, b) => b.clockIn - a.clockIn)[0];
    const onShift = !!(lastAttendance && !lastAttendance.clockOut && isSameDay(lastAttendance.clockIn));
    const distanceKm = customer.currentLocation && lastAttendance
      ? haversineKm(customer.currentLocation, lastAttendance.clockInLocation)
      : null;
    return { ...t, pendingCalls, onShift, distanceKm };
  });

  const nearestId = techInfo
    .filter((t) => t.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0]?.id || null;

  const sorted = [...techInfo].sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return a.pendingCalls - b.pendingCalls;
  });

  return (
    <div>
      <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 14 }}>
        {customer.name ? `${customer.name} — ` : ""}{customer.phone}{customer.location ? ` · ${customer.location}` : ""}
        {!customer.currentLocation && (
          <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 4 }}>
            No GPS location was captured for this customer, so "Nearest" can't be worked out — pick by pending calls below.
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>
        Select Technician
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {sorted.map((t) => {
          const selected = techId === t.id;
          return (
            <button
              key={t.id} type="button" onClick={() => setTechId(t.id)}
              style={{
                textAlign: "left", padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                background: selected ? COLORS.tealDim : COLORS.panel2,
                border: `1px solid ${selected ? COLORS.teal : COLORS.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {t.id === nearestId && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.teal, background: COLORS.tealDim, padding: "2px 8px", borderRadius: 999 }}>
                      Nearest
                    </span>
                  )}
                  {t.onShift && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.blue, background: "rgba(46,125,214,0.16)", padding: "2px 8px", borderRadius: 999 }}>
                      On shift
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>{t.specialty}</div>
              <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 4 }}>
                {t.pendingCalls} pending call{t.pendingCalls === 1 ? "" : "s"}
                {t.distanceKm !== null && ` · ~${t.distanceKm.toFixed(1)} km away`}
              </div>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ fontSize: 12, color: COLORS.faint }}>No outdoor technicians on file yet.</div>
        )}
      </div>

      <Field label="Customer's Preferred Visit Time — Estimated Visit Time">
        <Select value={visitTime} onChange={(e) => setVisitTime(e.target.value)}>
          {VISIT_TIME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
      </Field>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <Btn disabled={!techId} onClick={() => onAssign(techId, visitTime)}>
          <CheckCircle2 size={14} /> Assign &amp; Notify Technician
        </Btn>
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}


/*  Front Desk the moment a technician submits a repair status update.    */
/*  If several come in, they queue and show one at a time; the dashboard  */
/*  underneath stays covered by the modal backdrop until this is          */
/*  dismissed (by submitting an estimate), at which point the next one    */
/*  in the queue opens automatically.                                     */
/* ---------------------------------------------------------------------- */
function RepairRequestPopupBody({ job, onReview }) {
  const [estimate, setEstimate] = useState("");
  const [serviceCharge, setServiceCharge] = useState("");
  const total = (Number(estimate) || 0) + (Number(serviceCharge) || 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
        <Wrench size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
          The technician submitted a repair status update on <strong style={{ fontFamily: FONT_MONO }}>{job.id}</strong>. Add a repair estimate and service charge to send for customer approval.
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 4 }}>{job.customer} — {job.brand} {job.model}</div>
      {job.repairRemarks && (
        <div style={{ fontSize: 12.5, color: COLORS.text, marginBottom: 16, padding: "9px 11px", background: COLORS.panel2, borderRadius: 7, fontStyle: "italic" }}>
          "{job.repairRemarks}"
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
        <Field label="Repair Estimate (₹)">
          <Input type="number" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Service Charge (₹)">
          <Input type="number" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} placeholder="0" />
        </Field>
      </div>
      {(estimate || serviceCharge) && (
        <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>Total to quote: <strong style={{ fontFamily: FONT_MONO, color: COLORS.text }}>{fmtMoney(total)}</strong></div>
      )}
      <Btn
        style={{ width: "100%", marginTop: 6 }} disabled={!estimate && !serviceCharge}
        onClick={() => onReview(job.id, estimate || 0, serviceCharge || 0)}
      >
        <CheckCircle2 size={14} /> Send for Customer Approval
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  REPAIR ALERT ROW — one card per job in the bell menu's "Repair         */
/*  Requests" section. Two stages: "pending_review" (technician submitted  */
/*  a diagnosis, needs a repair estimate + service charge) and             */
/*  "awaiting_customer" (estimate sent, needs Admin/Front Desk to record   */
/*  whether the customer said yes or no).                                  */
/* ---------------------------------------------------------------------- */
function RepairAlertRow({ job, onReview, onConfirm, onDecline }) {
  const [estimate, setEstimate] = useState(job.estimate ? String(job.estimate) : "");
  const [serviceCharge, setServiceCharge] = useState(job.serviceCharge ? String(job.serviceCharge) : "");
  const isPendingReview = job.approvalStage === "pending_review";
  const total = (Number(estimate) || 0) + (Number(serviceCharge) || 0);

  return (
    <Panel style={{ padding: 10, border: `1px solid ${COLORS.teal}55`, background: `${COLORS.tealDim}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>Job #{job.id}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: isPendingReview ? COLORS.amber : COLORS.teal }}>
          {isPendingReview ? "Needs estimate" : "Awaiting customer"}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.text, lineHeight: 1.4, marginBottom: 8 }}>
        {job.customer} — {job.brand} {job.model}
        {job.repairRemarks && <><br /><span style={{ color: COLORS.muted }}>"{job.repairRemarks}"</span></>}
      </div>
      {isPendingReview ? (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <Input
              type="number" value={estimate} onChange={(e) => setEstimate(e.target.value)}
              placeholder="Repair estimate ₹" style={{ flex: 1, fontSize: 12 }}
            />
            <Input
              type="number" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)}
              placeholder="Service charge ₹" style={{ flex: 1, fontSize: 12 }}
            />
          </div>
          {(estimate || serviceCharge) && (
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>Total to quote: <strong style={{ fontFamily: FONT_MONO }}>{fmtMoney(total)}</strong></div>
          )}
          <Btn size="sm" variant="teal" style={{ width: "100%" }} disabled={!estimate && !serviceCharge} onClick={() => onReview(job.id, estimate || 0, serviceCharge || 0)}>
            Send for Approval
          </Btn>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="danger" style={{ flex: 1, borderColor: COLORS.red, background: COLORS.redDim }} onClick={() => onDecline(job.id)}>
            <X size={12} /> Not Approved
          </Btn>
          <Btn size="sm" variant="teal" style={{ flex: 1 }} onClick={() => onConfirm(job.id)}>
            <CheckCircle2 size={12} /> Confirmed OK
          </Btn>
        </div>
      )}
    </Panel>
  );
}

/* Minimal bell-dropdown card for a technician's 1-hour "check this job"
   reminder — no customer name/phone/fault detail, since technicians
   don't have access to that; just enough to know which job to go check. */
function TechReminderRow({ reminder, onDismiss }) {
  return (
    <Panel style={{ padding: 10, border: `1px solid ${COLORS.amber}55`, background: `${COLORS.amberDim}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>Job #{reminder.jobId}</span>
        <button onClick={() => onDismiss(reminder.id)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", padding: 0 }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.text, lineHeight: 1.4 }}>
        {reminder.brand} {reminder.model} — no update in over {reminder.stage}h. Please check this job.
      </div>
    </Panel>
  );
}

/* Shown inside a 2-hour reminder card/popup: if the job already has a
   technician, surfaces their name plus a one-tap "Get Feedback from
   Technician" button (routes through the same on-demand update-request
   flow as the Job Cards list — see requestJobUpdate). If nobody's
   assigned yet, offers an inline assign dropdown with each technician's
   current active-job workload, same pattern as UpdateJobForm's. Always
   reads the LIVE job record (not the reminder snapshot) so it reflects
   assignment changes made after the reminder fired. */
function ReminderTechSection({ reminder, jobs, technicians, onAssignTech, onRequestFeedback, compact }) {
  const liveJob = (jobs || []).find((j) => j.id === reminder.jobId);
  const assignedTechId = liveJob ? liveJob.assignedTech : reminder.assignedTech;
  const jobTypeVal = liveJob ? liveJob.jobType : reminder.jobType;
  const assignedTech = assignedTechId ? (technicians || []).find((t) => t.id === assignedTechId) : null;
  const [assigning, setAssigning] = useState(false);
  const relevantTechs = (technicians || []).filter((t) => !jobTypeVal || t.type === jobTypeVal);

  const boxStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
    fontSize: compact ? 11.5 : 12.5, padding: compact ? "6px 8px" : "9px 12px",
    borderRadius: compact ? 6 : 8, marginBottom: compact ? 8 : 14,
  };

  if (assignedTech) {
    return (
      <div style={{ ...boxStyle, background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55` }}>
        <span>Technician: <strong>{assignedTech.name}</strong></span>
        {onRequestFeedback && (
          <Btn size="sm" variant="outline" onClick={() => onRequestFeedback(reminder.jobId)}>
            <RefreshCw size={12} /> Get Feedback from Technician
          </Btn>
        )}
      </div>
    );
  }

  if (!onAssignTech) return null;

  return (
    <div style={{ marginBottom: compact ? 8 : 14 }}>
      {!assigning ? (
        <div style={{ ...boxStyle, marginBottom: 0, background: COLORS.redDim, border: `1px solid ${COLORS.red}55` }}>
          <span>No technician assigned yet</span>
          <Btn size="sm" variant="outline" onClick={() => setAssigning(true)}>
            <Wrench size={12} /> Assign Technician
          </Btn>
        </div>
      ) : (
        <Field label="Assign Technician — workload shown per technician">
          <Select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onAssignTech(reminder.jobId, e.target.value);
              setAssigning(false);
            }}
          >
            <option value="" disabled>Select technician…</option>
            {relevantTechs.map((t) => {
              const activeCount = (jobs || []).filter((j) => j.assignedTech === t.id && ACTIVE_JOB_STATUSES.includes(j.status)).length;
              return (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.specialty} — {activeCount} active job{activeCount === 1 ? "" : "s"}
                </option>
              );
            })}
          </Select>
        </Field>
      )}
    </div>
  );
}


function ReminderRow({ reminder, jobs, technicians, onAssignTech, onRequestFeedback, onSendWhatsApp, onSendSms, onCall, onDismiss }) {
  const [status, setStatus] = useState(REMINDER_STATUS_OPTIONS[0].label);
  const [otherSubStatus, setOtherSubStatus] = useState(OTHER_SUB_STATUS_OPTIONS[0]);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const isInitial = reminder.stage === 1;
  const isDaily = reminder.stage === "daily";

  const sendArgs = [
    reminder,
    isInitial || isDaily ? undefined : status,
    status === "Waiting for Spares" ? days : undefined,
    status === "In Repair" ? reason : undefined,
    status === "In Repair" ? customReason : undefined,
    status === "Others" ? otherSubStatus : undefined,
  ];

  return (
    <Panel style={{ padding: 10, border: `1px solid ${COLORS.amber}55`, background: `${COLORS.amberDim}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>Job #{reminder.jobId}</span>
        <button onClick={() => onDismiss(reminder.id)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", padding: 0 }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.text, lineHeight: 1.4, marginBottom: 6 }}>
        {isInitial
          ? <>Send initial fault diagnosis (<strong>{reminder.fault}</strong>) to {reminder.customer}?</>
          : isDaily
          ? <>Daily spare-wait check-in: let {reminder.customer} know the part is still on order.</>
          : <>Reminder #{reminder.stage}: update current status and notify {reminder.customer}.</>}
      </div>
      {reminder.subFaults && reminder.subFaults.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {reminder.subFaults.map((sf) => (
            <span key={sf} style={{ fontSize: 10, background: COLORS.panel2, color: COLORS.teal, padding: "2px 7px", borderRadius: 999, border: `1px solid ${COLORS.border}` }}>{sf}</span>
          ))}
        </div>
      )}
      {!isDaily && (
        <ReminderTechSection
          reminder={reminder} jobs={jobs} technicians={technicians}
          onAssignTech={onAssignTech} onRequestFeedback={onRequestFeedback} compact
        />
      )}
      {!isInitial && !isDaily && (
        <>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginBottom: status === "Waiting for Spares" || status === "In Repair" || status === "Others" ? 6 : 8, fontSize: 12 }}>
            {REMINDER_STATUS_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
          </Select>
          {status === "Others" && (
            <Select value={otherSubStatus} onChange={(e) => setOtherSubStatus(e.target.value)} style={{ marginBottom: 8, fontSize: 12 }}>
              {OTHER_SUB_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          )}
          {status === "Waiting for Spares" && (
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ marginBottom: 8, fontSize: 12 }}>
              {SPARE_WAIT_DAY_OPTIONS.map((d) => <option key={d} value={d}>Wait {d} day{d > 1 ? "s" : ""}</option>)}
            </Select>
          )}
          {status === "In Repair" && (
            <>
              <Select value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginBottom: 6, fontSize: 12 }}>
                {IN_PROGRESS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
              <TextArea
                value={customReason} onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Custom reason (optional)…" style={{ marginBottom: 8, fontSize: 12, minHeight: 50 }}
              />
            </>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="outline" style={{ flex: 1 }} onClick={() => onCall(reminder)}>
          <Phone size={12} /> Call
        </Btn>
        <Btn size="sm" variant="outline" style={{ flex: 1 }} onClick={() => onSendSms(...sendArgs)}>
          <MessageSquare size={12} /> SMS
        </Btn>
        <Btn size="sm" variant="teal" style={{ flex: 1 }} onClick={() => onSendWhatsApp(...sendArgs)}>
          <MessageSquare size={12} /> WhatsApp
        </Btn>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- */
/*  REMINDER POPUP — auto-opened modal for a 2-hour check-in on a job     */
/*  that's actively In Progress. Shows the Job ID, main fault category,   */
/*  and every section-wise sub-fault checked, then lets the technician    */
/*  pick a status and fire off the detailed WhatsApp update in one tap.   */
/* ---------------------------------------------------------------------- */
function ReminderPopupBody({ reminder, jobs, technicians, onAssignTech, onRequestFeedback, onSendWhatsApp, onSendSms, onCall, onClose }) {
  const [status, setStatus] = useState(REMINDER_STATUS_OPTIONS[0].label);
  const [otherSubStatus, setOtherSubStatus] = useState(OTHER_SUB_STATUS_OPTIONS[0]);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const isDaily = reminder.stage === "daily";
  const sendArgs = [
    isDaily ? undefined : status,
    status === "Waiting for Spares" ? days : undefined,
    status === "In Repair" ? reason : undefined,
    status === "In Repair" ? customReason : undefined,
    status === "Others" ? otherSubStatus : undefined,
  ];
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 12px",
        background: `${COLORS.redDim}55`, border: `1px solid ${COLORS.red}55`, borderRadius: 8,
      }}>
        <AlertTriangle size={15} color={COLORS.red} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>
          {isDaily
            ? "This job's spare part is still on order — send today's check-in to the customer."
            : `This job has been in progress for over ${reminder.stage * 2}h without a customer update.`}
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 4 }}>Job ID</div>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 16, marginBottom: 14 }}>#{reminder.jobId}</div>

      <ReminderTechSection
        reminder={reminder} jobs={jobs} technicians={technicians}
        onAssignTech={onAssignTech} onRequestFeedback={onRequestFeedback}
      />

      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6 }}>Main Fault Category</div>
      <div style={{
        display: "inline-block", fontSize: 12, fontWeight: 700, background: COLORS.amberDim, color: COLORS.amber,
        padding: "4px 11px", borderRadius: 999, marginBottom: 16,
      }}>
        {reminder.fault}
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>Sub-Sections Checked</div>
      {reminder.subFaults && reminder.subFaults.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 18 }}>
          {reminder.subFaults.map((sf) => (
            <div key={sf} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>
              <CheckCircle2 size={14} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} /> {sf}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 18 }}>No specific sub-sections logged yet for this job.</div>
      )}

      {!isDaily && (
        <>
          <Field label="Current Status to Send">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {REMINDER_STATUS_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
            </Select>
          </Field>
          {status === "Others" && (
            <div style={{ marginTop: 12 }}>
              <Field label="Others — Sub-Status">
                <Select value={otherSubStatus} onChange={(e) => setOtherSubStatus(e.target.value)}>
                  {OTHER_SUB_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {status === "Waiting for Spares" && (
            <div style={{ marginTop: 12 }}>
              <Field label="Wait Time">
                <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {SPARE_WAIT_DAY_OPTIONS.map((d) => <option key={d} value={d}>Wait {d} day{d > 1 ? "s" : ""}</option>)}
                </Select>
              </Field>
              <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 6 }}>
                While waiting, this job switches from 2-hour reminders to one check-in per day.
              </div>
            </div>
          )}
          {status === "In Repair" && (
            <div style={{ marginTop: 12 }}>
              <Field label="Reason (feedback to customer)">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {IN_PROGRESS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <div style={{ marginTop: 10 }}>
                <Field label="Custom Reason (optional)">
                  <TextArea value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Add any extra detail…" />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <Btn variant="outline" onClick={onCall}>
          <Phone size={14} /> Call Now
        </Btn>
        <Btn variant="outline" onClick={() => onSendSms(...sendArgs)}>
          <MessageSquare size={14} /> {isDaily ? "Send Daily SMS Update" : "Send SMS Update"}
        </Btn>
        <Btn variant="teal" onClick={() => onSendWhatsApp(...sendArgs)}>
          <MessageSquare size={14} /> {isDaily ? "Send Daily WhatsApp Update" : "Send WhatsApp Update"}
        </Btn>
        <Btn variant="outline" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  FAULT SELECTOR — main category dropdown + dynamic section-wise        */
/*  sub-fault checklist. Reused at job intake and by technicians when     */
/*  updating a job. Big tap targets for mobile; bilingual EN/Tamil        */
/*  labels on every checkbox.                                             */
/* ---------------------------------------------------------------------- */
function FaultSelector({ fault, setFault, subFaults, setSubFaults, allowNone }) {
  const options = SUB_FAULTS[fault] || [];

  const toggle = (key) => {
    setSubFaults((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label={allowNone ? "Main Fault Category (optional)" : "Main Fault Category"}>
        <Select value={fault} onChange={(e) => { setFault(e.target.value); setSubFaults([]); }}>
          {allowNone && <option value="">— None (optional) —</option>}
          {DEFAULT_FAULTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
      </Field>

      {options.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>
            Section-wise Sub-Faults — {fault}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {options.map((o) => {
              const checked = subFaults.includes(o.en);
              return (
                <label
                  key={o.en}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 13px", borderRadius: 9,
                    background: checked ? COLORS.tealDim : COLORS.panel2,
                    border: `1px solid ${checked ? COLORS.teal : COLORS.border}`,
                    cursor: "pointer", userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.en)}
                    style={{ marginTop: 3, width: 18, height: 18, accentColor: COLORS.teal, flexShrink: 0, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
                    {o.en}
                    <br />
                    <span style={{ fontSize: 11, color: COLORS.faint }}>{o.ta}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {subFaults.length > 0 && (
            <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 8 }}>
              {subFaults.length} sub-section{subFaults.length === 1 ? "" : "s"} selected
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  TOAST                                                                   */
/* ---------------------------------------------------------------------- */
function Toast({ toast }) {
  const kindColor = toast.kind === "alert" ? COLORS.amber : toast.kind === "ok" ? COLORS.teal : COLORS.blue;
  const Icon = toast.kind === "alert" ? AlertTriangle : toast.kind === "ok" ? CheckCircle2 : MessageSquare;
  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, left: 20, maxWidth: 360, marginLeft: "auto",
      background: COLORS.glass2, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      border: `1px solid ${kindColor}55`, borderRadius: 10, padding: "12px 14px", display: "flex", gap: 10,
      boxShadow: "0 10px 30px rgba(80,20,120,0.25)", zIndex: 200, alignItems: "flex-start",
    }}>
      <Icon size={16} color={kindColor} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>{toast.message}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  DASHBOARD (Admin)                                                       */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  ADD JOB BUTTON — big, unmissable "+ Add Job" call-to-action shown at   */
/*  the top of the Admin and Front Desk dashboards.                        */
/* ---------------------------------------------------------------------- */
function AddJobButton({ onClick, subtitle, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 240, display: "flex", alignItems: "center", gap: 16,
        padding: "20px 22px", borderRadius: 14, border: "none", cursor: "pointer", textAlign: "left",
        background: `linear-gradient(135deg, ${COLORS.amber}, #D98B1F)`,
        boxShadow: "0 10px 26px rgba(240,166,58,0.28)",
        ...style,
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14, background: "rgba(0,0,0,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Plus size={28} color="#1A1300" strokeWidth={3} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1A1300" }}>+ Add New Job</div>
        <div style={{ fontSize: 12.5, color: "#4A3410", marginTop: 2 }}>{subtitle || "Create a new LED TV repair job card"}</div>
      </div>
    </button>
  );
}

/* Same big-CTA treatment as AddJobButton, teal-accented, for logging a
   new customer/enquiry (CID) — shown right next to "+ Add New Job" on
   every login. */
function AddCustomerButton({ onClick, subtitle, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 240, display: "flex", alignItems: "center", gap: 16,
        padding: "20px 22px", borderRadius: 14, border: "none", cursor: "pointer", textAlign: "left",
        background: `linear-gradient(135deg, ${COLORS.teal}, #0B7A70)`,
        boxShadow: "0 10px 26px rgba(13,148,136,0.28)",
        ...style,
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14, background: "rgba(0,0,0,0.16)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Plus size={28} color="#00251F" strokeWidth={3} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#00251F" }}>+ Add New Customer</div>
        <div style={{ fontSize: 12.5, color: "#0A3B36", marginTop: 2 }}>{subtitle || "Log a call or walk-in enquiry (CID)"}</div>
      </div>
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/*  TECHNICIAN DASHBOARD (Indoor / Outdoor)                                */
/*  Deliberately minimal: these logins can only add new jobs — they have  */
/*  no visibility into existing/old job cards. A big "+" FAB plus a       */
/*  matching CTA card is the entire page.                                  */
/* ---------------------------------------------------------------------- */
function TechnicianDashboard({ role, tech, onAddJob, onAddCustomer, onMyJobs, extraTasks = [], onCompleteExtraWork }) {
  const roleTitle = role === "indoor_tech" ? "Indoor Technician" : "Outdoor Technician";
  const pendingTasks = extraTasks.filter((t) => t.status === "pending");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "relative", minHeight: 420 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Welcome, {tech?.name || roleTitle}</div>
        <div style={{ fontSize: 12.5, color: COLORS.faint, marginTop: 2 }}>{tech?.specialty || roleTitle}</div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <AddJobButton onClick={onAddJob} subtitle="Log a new TV intake — fault photo, section-wise fault checklist, all in one go" />
        <AddCustomerButton onClick={onAddCustomer} subtitle="Log a caller or walk-in before a TV arrives" />
      </div>

      {role === "indoor_tech" && onMyJobs && (
        <Btn variant="outline" onClick={onMyJobs} style={{ alignSelf: "flex-start" }}>
          <Wrench size={14} /> My Jobs
        </Btn>
      )}

      {pendingTasks.length > 0 && (
        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ClipboardList size={15} color={COLORS.blue} />
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>Extra Work Assigned</span>
            <span style={{ fontSize: 11, background: `${COLORS.blue}22`, color: COLORS.blue, padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>{pendingTasks.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingTasks.map((task) => (
              <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {task.priority === "urgent" && <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.red, background: COLORS.redDim, padding: "1px 6px", borderRadius: 999 }}>URGENT</span>}
                    {task.title}
                  </div>
                  {task.notes && <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 3 }}>{task.notes}</div>}
                  <div style={{ fontSize: 10.5, color: COLORS.faint, marginTop: 4 }}>
                    From {task.assignedBy}{task.dueAt ? ` · Due ${fmtDateTime(task.dueAt)}` : ""}
                  </div>
                </div>
                <Btn size="sm" variant="teal" onClick={() => onCompleteExtraWork && onCompleteExtraWork(task.id)} style={{ flexShrink: 0 }}>
                  <CheckCircle2 size={12} /> Done
                </Btn>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Floating "+" shortcut, always reachable while scrolling */}
      <button
        onClick={onAddJob}
        title="Add new job"
        style={{
          position: "fixed", right: 26, bottom: 26, width: 58, height: 58, borderRadius: 999,
          background: COLORS.amber, border: "none", cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", boxShadow: "0 10px 24px rgba(0,0,0,0.45)", zIndex: 30,
        }}
      >
        <Plus size={26} color="#1A1300" strokeWidth={3} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  MY JOBS (Indoor Technician) — jobs assigned to this technician, with   */
/*  customer name, phone, location, and estimated cost deliberately        */
/*  withheld. Everything needed to actually do the repair (device, fault   */
/*  detail, sub-sections, photos, status, parts, timeline) is shown.       */
/* ---------------------------------------------------------------------- */
/* Lets a technician hand a job back when they can't complete it — an
   optional reason, then a confirm step. Once requested, the section just
   shows a waiting notice until Admin/Front Desk reassigns it (the job
   drops out of this technician's My Jobs the moment they confirm, since
   requestReassignment clears assignedTech immediately). */
function ReassignJobSection({ job, onRequest }) {
  const [requesting, setRequesting] = useState(false);
  const [reason, setReason] = useState("");

  if (job.reassignmentRequested) {
    return (
      <div style={{ padding: "10px 12px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 8, fontSize: 12, color: COLORS.text }}>
        Reassignment already requested — waiting on Front Desk/Admin to assign another technician.
      </div>
    );
  }

  if (!requesting) {
    return (
      <Btn variant="outline" size="sm" onClick={() => setRequesting(true)}>
        <RefreshCw size={13} /> Can't Do This Job — Request Reassignment
      </Btn>
    );
  }

  return (
    <div>
      <Field label="Reason (optional, shown to Front Desk/Admin)">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Needs a specialist for panel-level micro-soldering…" />
      </Field>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <Btn variant="danger" size="sm" onClick={() => onRequest(reason.trim())}>
          <AlertTriangle size={13} /> Confirm Reassignment Request
        </Btn>
        <Btn variant="outline" size="sm" onClick={() => setRequesting(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

/* Technician's response to an on-demand "send me a current update" request
   from Admin/Front Desk — same flat status list + Others sub-status split
   as UpdateJobForm, plus a note. Submitting applies the real status to the
   job right away but leaves composing/sending the customer message to
   Admin/Front Desk (see submitJobUpdateResponse). */
function TechUpdateRequestForm({ job, onSubmit }) {
  const isSubStatusValue = OTHER_SUB_STATUS_OPTIONS.includes(job.status) && !MAIN_STATUS_OPTIONS.includes(job.status);
  const [mainStatus, setMainStatus] = useState(isSubStatusValue ? "others" : job.status);
  const [subStatus, setSubStatus] = useState(isSubStatusValue ? job.status : OTHER_SUB_STATUS_OPTIONS[0]);
  const [note, setNote] = useState("");
  const status = mainStatus === "others" ? subStatus : mainStatus;

  return (
    <div>
      <Field label="Current Status">
        <Select value={mainStatus} onChange={(e) => setMainStatus(e.target.value)}>
          {MAIN_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </Field>
      {mainStatus === "others" && (
        <>
          <div style={{ height: 12 }} />
          <Field label="Others — Sub-Status">
            <Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
              {OTHER_SUB_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          </Field>
        </>
      )}
      <div style={{ height: 12 }} />
      <Field label="Note — tap the mic to speak">
        <VoiceInput value={note} onChange={setNote} placeholder="e.g. Panel replaced, testing now — should be ready by evening…" lang="en" multiline />
      </Field>
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => onSubmit(status, note.trim())}>
          <CheckCircle2 size={13} /> Submit Update
        </Btn>
      </div>
    </div>
  );
}

/* Admin/Front Desk's review screen for a technician's response to a
   requested update: shows the technician's raw status + note, and an
   editable customer-facing message (prefilled, "modify" is just editing
   it) with independent Send-via-SMS / Send-via-WhatsApp actions — either
   or both can be used before closing out with Done. */
function TechUpdateFeedbackBody({ job, onSend, onDone }) {
  const update = job.pendingCustomerUpdate;
  const [message, setMessage] = useState(update?.message || "");
  const [sentVia, setSentVia] = useState([]);

  if (!update) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 9 }}>
        <CheckCircle2 size={18} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
          <strong>{update.by}</strong> reported status <strong>{STATUS_META[update.statusKey]?.label || update.statusKey}</strong>
          {update.note ? <> — <em>"{update.note}"</em></> : "."}
        </div>
      </div>

      <Field label="Message to Customer — edit if needed, tap the mic to speak">
        <VoiceInput value={message} onChange={setMessage} placeholder="Message to send…" lang="en" multiline />
      </Field>

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <Btn
          variant="outline"
          onClick={() => { onSend("sms", message); setSentVia((v) => [...v, "sms"]); }}
        >
          <MessageSquare size={14} /> {sentVia.includes("sms") ? "Sent via SMS ✓" : "Send via SMS"}
        </Btn>
        <Btn
          variant="teal"
          onClick={() => { onSend("whatsapp", message); setSentVia((v) => [...v, "whatsapp"]); }}
        >
          <MessageSquare size={14} /> {sentVia.includes("whatsapp") ? "Sent via WhatsApp ✓" : "Send via WhatsApp"}
        </Btn>
        <Btn variant="ghost" onClick={onDone}>Done</Btn>
      </div>
    </div>
  );
}


function MyJobsView({ jobs, tick, onSubmitRepairReport, onRequestReassignment }) {
  const [detail, setDetail] = useState(null);
  const active = jobs.filter((j) => j.status !== "delivered");
  const done = jobs.filter((j) => j.status === "delivered");

  const stageBadge = (j) => {
    if (j.approvalStage === "pending_review") return { label: "Awaiting review", color: COLORS.amber };
    if (j.approvalStage === "awaiting_customer") return { label: "Awaiting customer", color: COLORS.blue };
    if (j.approvalStage === "confirmed" || j.approvalStage === "acknowledged") return { label: "Approved to proceed", color: COLORS.teal };
    if (j.approvalStage === "declined" || j.approvalStage === "declined_acknowledged") return { label: "Return to customer", color: COLORS.red };
    return null;
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>My Jobs</div>
        <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 2 }}>
          {active.length} active job{active.length === 1 ? "" : "s"} assigned to you.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.length === 0 && <div style={{ color: COLORS.faint, fontSize: 13 }}>No jobs assigned to you right now.</div>}
        {sortByUrgency(active).map((j) => {
          const stage = stageBadge(j);
          return (
            <Panel key={j.id} style={{ padding: 15, cursor: "pointer" }} onClick={() => setDetail(j)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{j.id}</span>
                <Badge status={j.status} />
                {stage && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: stage.color, background: `${stage.color}22`, padding: "2px 8px", borderRadius: 999 }}>
                    {stage.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{j.brand} {j.model}</div>
              <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{j.issue}</div>
              <FaultTags job={j} />
              <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 6 }}>Intake {timeAgo(j.intake, tick)}</div>
            </Panel>
          );
        })}
      </div>

      {done.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12.5, color: COLORS.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Delivered</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {done.map((j) => (
              <div
                key={j.id} onClick={() => setDetail(j)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "8px 10px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.muted, cursor: "pointer" }}
              >
                <span style={{ fontFamily: FONT_MONO }}>{j.id}</span><span>{j.brand} {j.model}</span><Badge status={j.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`${detail.id} — Job Details`} onClose={() => setDetail(null)}>
          {(() => {
            const stage = stageBadge(detail);
            return stage ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 12px",
                background: `${stage.color}1c`, border: `1px solid ${stage.color}55`, borderRadius: 8,
              }}>
                {detail.approvalStage === "awaiting_customer" ? <Clock size={14} color={stage.color} /> : detail.approvalStage === "declined" || detail.approvalStage === "declined_acknowledged" ? <X size={14} color={stage.color} /> : <CheckCircle2 size={14} color={stage.color} />}
                <span style={{ fontSize: 12.5, color: COLORS.text }}>
                  {detail.approvalStage === "pending_review" && "Your diagnosis has been submitted — waiting on Admin/Front Desk to review and set an estimate."}
                  {detail.approvalStage === "awaiting_customer" && "Estimate sent — Admin/Front Desk is waiting on the customer's OK before you proceed."}
                  {(detail.approvalStage === "confirmed" || detail.approvalStage === "acknowledged") && "Customer confirmed — you're clear to proceed with the repair."}
                  {(detail.approvalStage === "declined" || detail.approvalStage === "declined_acknowledged") && "Customer did not approve the repair — pack up the TV for return, no repair needed."}
                </span>
              </div>
            ) : null;
          })()}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
            <div><span style={{ color: COLORS.faint }}>Device:</span> {detail.brand} {detail.model}</div>
            <div><span style={{ color: COLORS.faint }}>Status:</span> <Badge status={detail.status} /></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Issue:</span> {detail.issue}</div>
            {detail.accessories && (
              <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Accessories:</span> {detail.accessories}</div>
            )}
            {detail.fault && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: COLORS.faint }}>Section-wise Fault:</span>
                <FaultTags job={detail} />
              </div>
            )}
            {detail.partsUsed.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: COLORS.faint }}>Parts used:</span> {detail.partsUsed.map((p) => `${p.partId} x${p.qty}${p.remark ? ` (${p.remark})` : ""}`).join(", ")}
              </div>
            )}
            {(detail.faultPhoto || detail.readyPhoto) && (
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 14, marginTop: 4 }}>
                {detail.faultPhoto && (
                  <div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Fault Photo</div>
                    <img src={detail.faultPhoto} alt="Fault" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                  </div>
                )}
                {detail.readyPhoto && (
                  <div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>TV Ready Photo</div>
                    <img src={detail.readyPhoto} alt="TV ready for delivery" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {onSubmitRepairReport && detail.status !== "delivered" && detail.approvalStage !== "declined" && detail.approvalStage !== "declined_acknowledged" && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
                Update Repair Status &amp; Remarks
              </div>
              <RepairReportForm
                job={detail}
                onSubmit={(status, remarks, fault, subFaults) => { onSubmitRepairReport(detail.id, status, remarks, fault, subFaults); setDetail(null); }}
              />
              <div style={{ height: 18 }} />
            </>
          )}

          {onRequestReassignment && detail.status !== "delivered" && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
                Unable To Complete This Job?
              </div>
              <ReassignJobSection
                job={detail}
                onRequest={(reason) => { onRequestReassignment(detail.id, reason); setDetail(null); }}
              />
              <div style={{ height: 18 }} />
            </>
          )}

          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>Update Timeline</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {detail.updates.map((u, i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.amber, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12.5 }}><strong>{u.by}</strong> — {u.note}</div>
                  <div style={{ fontSize: 11, color: COLORS.faint }}>{fmtDateTime(u.ts)} · <Badge status={u.status} /></div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* Technician's repair status + remarks submission — status choices stay
   limited to Pending/In Progress/Completed (no Delivered — that's a
   front-desk action gated behind the TV Ready photo). Submitting moves
   the job into the "pending_review" approval stage. */
const TECH_STATUS_OPTIONS = ["under_diagnosis", "fault_identified", "in_repair", "ready_for_delivery", "not_ready"];

function RepairReportForm({ job, onSubmit }) {
  const [status, setStatus] = useState(TECH_STATUS_OPTIONS.includes(job.status) ? job.status : TECH_STATUS_OPTIONS[0]);
  const [remarks, setRemarks] = useState("");
  const [fault, setFault] = useState(job.fault || DEFAULT_FAULTS[0]);
  const [subFaults, setSubFaults] = useState(job.subFaults || []);
  const faultRequired = !!SUB_FAULTS[fault];
  const faultValid = !faultRequired || subFaults.length > 0;

  return (
    <div>
      <Field label="Current TV Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {TECH_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </Field>
      <div style={{ height: 10 }} />
      <div style={{
        padding: "10px 12px", borderRadius: 8, background: faultValid ? COLORS.panel2 : COLORS.redDim,
        border: `1px solid ${faultValid ? COLORS.border : COLORS.red}55`,
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: faultValid ? COLORS.muted : COLORS.red, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>
          Section-Wise Fault — required, must be marked by technician
        </div>
        <FaultSelector fault={fault} setFault={setFault} subFaults={subFaults} setSubFaults={setSubFaults} />
        {!faultValid && (
          <div style={{ marginTop: 8, fontSize: 12, color: COLORS.red, fontWeight: 600 }}>
            Select at least one sub-section for "{fault}" before submitting.
          </div>
        )}
      </div>
      <div style={{ height: 10 }} />
      <Field label="Remarks / Solution">
        <TextArea
          value={remarks} onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. Backlight strip burnt, needs replacement. Repair possible, part on hand."
        />
      </Field>
      <div style={{ marginTop: 12 }}>
        <Btn disabled={!remarks.trim() || !faultValid} onClick={() => onSubmit(status, remarks.trim(), fault, subFaults)}>
          <Wrench size={13} /> Submit for Approval
        </Btn>
      </div>
    </div>
  );
}

function Dashboard({ jobs, invoices, technicians, parts, revenueToday, outstandingDues, pendingOrders, liveLocations, tick, onAddJob, onAddCustomer, onUpdate, onAssignTech, onWhatsApp, onSms, onCall, onPrint, onConfirmApproval, onDeclineApproval, onViewLiveTracking, smsLog, labelPrintEnforced = false, standbyLoans = [], onGiveStandby, onMarkStandbyReturned }) {
  const lowStock = parts.filter((p) => p.qty <= p.low);
  const workload = technicians.map((t) => ({
    ...t,
    active: jobs.filter((j) => j.assignedTech === t.id && ACTIVE_JOB_STATUSES.includes(j.status)).length,
    completed: jobs.filter((j) => j.assignedTech === t.id && ["ready_for_delivery", "delivered", "returned_unrepaired", "closed"].includes(j.status)).length,
  }));
  const maxActive = Math.max(1, ...workload.map((w) => w.active));
  const [showPendingList, setShowPendingList] = useState(false);
  const [showTotalRevenue, setShowTotalRevenue] = useState(false);
  const [totalRevFrom, setTotalRevFrom] = useState("");
  const [totalRevTo, setTotalRevTo] = useState("");
  const [detailJob, setDetailJob] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  useBackClose("dash-showPendingList", showPendingList, () => setShowPendingList(false));
  useBackClose("dash-showTotalRevenue", showTotalRevenue, () => setShowTotalRevenue(false));
  useBackClose("dash-detailJob", !!detailJob, () => setDetailJob(null));
  useBackClose("dash-editingJob", !!editingJob, () => setEditingJob(null));

  const totalRevRangeInvoices = invoices.filter((inv) => {
    if (inv.paymentStatus !== "Paid" || !inv.paidAt) return false;
    const d = new Date(inv.paidAt);
    if (totalRevFrom && d < new Date(totalRevFrom + "T00:00:00")) return false;
    if (totalRevTo && d > new Date(totalRevTo + "T23:59:59")) return false;
    return true;
  });
  const totalRevInRange = totalRevRangeInvoices.reduce((sum, inv) => sum + inv.total, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <AddCustomerButton onClick={onAddCustomer} />
        <AddJobButton onClick={onAddJob} />
      </div>

      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pendingOrders.length} sub="Tap to view the list" accent={COLORS.amber} onClick={() => setShowPendingList(true)} />
        <StatCard icon={IndianRupee} label="Revenue Today" value={fmtMoney(revenueToday)} sub="Paid invoices, today" accent={COLORS.teal} />
        <StatCard icon={AlertTriangle} label="Outstanding Dues" value={fmtMoney(outstandingDues)} sub="Unpaid invoices" accent={COLORS.red} />
        <StatCard icon={MapPin} label="Technician Locations" value={Object.keys(liveLocations || {}).length} sub="Tap to view live map" accent={COLORS.blue} onClick={onViewLiveTracking} />
      </div>

      {/* Nothing about total revenue is ever displayed here — the figure only
          appears once this button is tapped and the modal is opened. */}
      <Btn variant="outline" onClick={() => setShowTotalRevenue(true)} style={{ alignSelf: "flex-start" }}>
        <Eye size={14} /> View Total Revenue (Custom Dates)
      </Btn>

      <div className="dashboard-2col" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Panel style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Technician Workload</div>
            <Users size={15} color={COLORS.faint} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {workload.map((w) => (
              <div key={w.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600 }}>{w.name}</span>
                  <span style={{ color: COLORS.faint, fontFamily: FONT_MONO }}>{w.active} active · {w.completed} done</span>
                </div>
                <div style={{ height: 7, borderRadius: 999, background: COLORS.panel2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(w.active / maxActive) * 100}%`, background: w.active > 2 ? COLORS.red : COLORS.amber, borderRadius: 999, transition: "width .3s" }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Low Stock Alerts</div>
            <Package size={15} color={COLORS.faint} />
          </div>
          {lowStock.length === 0 ? (
            <div style={{ fontSize: 12.5, color: COLORS.faint }}>All spare parts sufficiently stocked.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {lowStock.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5 }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, fontFamily: FONT_MONO, color: COLORS.red, fontWeight: 700 }}>{p.qty} left</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Pending Service Orders</div>
          <TrendingUp size={15} color={COLORS.faint} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {pendingOrders.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No pending orders — bench is clear.</div>}
          {sortByUrgency(pendingOrders).map((j) => (
            <div
              key={j.id} className="rowhover data-row"
              onClick={() => setDetailJob(j)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, width: 78 }}>{j.id}</span>
              <span style={{ fontSize: 12.5, flex: 1 }}>{j.customer} — {j.brand} {j.model}</span>
              <span style={{ fontSize: 11.5, color: COLORS.faint, width: 130 }}>{j.assignedTech ? techMapName(technicians, j.assignedTech) : "Unassigned"}</span>
              <span style={{ fontSize: 11, color: COLORS.faint, width: 90 }}>{timeAgo(j.intake, tick)}</span>
              <Badge status={j.status} />
              <StandbyLoanBadge loan={standbyLoans.find((l) => l.jobId === j.id && !l.returned)} tick={tick} onMarkReturned={onMarkStandbyReturned} />
              {onGiveStandby && STANDBY_ELIGIBLE_STATUSES.includes(j.status) && !standbyLoans.some((l) => l.jobId === j.id && !l.returned) && (
                <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onGiveStandby(j); }}><Tv size={12} /></Btn>
              )}
              <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onCall(j); }}><Phone size={12} /></Btn>
              <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onSms(j); }}><MessageSquare size={12} /></Btn>
              <Btn size="sm" variant="teal" onClick={(e) => { e.stopPropagation(); onWhatsApp(j); }}><MessageSquare size={12} /></Btn>
            </div>
          ))}
        </div>
      </Panel>

      {showPendingList && (
        <Modal title={`Pending Orders (${pendingOrders.length})`} onClose={() => setShowPendingList(false)} width={520}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingOrders.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No pending orders — bench is clear.</div>}
            {sortByUrgency(pendingOrders).map((j) => (
              <div
                key={j.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
                }}
              >
                <button
                  onClick={() => { setDetailJob(j); setShowPendingList(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{j.id}</span>
                  <span style={{ fontSize: 12.5, flex: 1, color: COLORS.muted }}>{j.customer} — {j.brand} {j.model}</span>
                  <Badge status={j.status} />
                  <StandbyLoanBadge loan={standbyLoans.find((l) => l.jobId === j.id && !l.returned)} tick={tick} />
                  <ChevronRight size={15} color={COLORS.faint} />
                </button>
                <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={12} /></Btn>
                <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={12} /></Btn>
                <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={12} /></Btn>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {detailJob && (
        <Modal title={`${detailJob.id} — Job History`} onClose={() => setDetailJob(null)}>
          <JobDetail job={detailJob} technicians={technicians} onWhatsApp={onWhatsApp} onSms={onSms} onCall={onCall} onConfirmApproval={onConfirmApproval} onDeclineApproval={onDeclineApproval} smsLog={smsLog} />
          {detailJob.status !== "delivered" && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={() => { setEditingJob(detailJob); setDetailJob(null); }}>
                <Wrench size={14} /> Update Status
              </Btn>
              {onGiveStandby && STANDBY_ELIGIBLE_STATUSES.includes(detailJob.status) && !standbyLoans.some((l) => l.jobId === detailJob.id && !l.returned) && (
                <Btn variant="outline" onClick={() => { onGiveStandby(detailJob); setDetailJob(null); }}>
                  <Tv size={14} /> Give Standby TV
                </Btn>
              )}
            </div>
          )}
        </Modal>
      )}

      {editingJob && (
        <Modal title={`Update ${editingJob.id}`} onClose={() => setEditingJob(null)}>
          <UpdateJobForm
            job={editingJob} parts={parts} technicians={technicians} jobs={jobs}
            onSave={(payload) => { onUpdate(editingJob.id, payload); setEditingJob(null); }}
            onAssignTech={onAssignTech}
            onWhatsApp={onWhatsApp}
            labelPrintEnforced={labelPrintEnforced}
          />
        </Modal>
      )}

      {showTotalRevenue && (
        <Modal title="Total Revenue — Custom Dates" onClose={() => setShowTotalRevenue(false)} width={560}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <Field label="From">
              <Input type="date" value={totalRevFrom} onChange={(e) => setTotalRevFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={totalRevTo} onChange={(e) => setTotalRevTo(e.target.value)} />
            </Field>
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "14px 16px",
            background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 10,
          }}>
            <IndianRupee size={22} color={COLORS.teal} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: FONT_MONO, color: COLORS.text }}>{fmtMoney(totalRevInRange)}</div>
              <div style={{ fontSize: 11.5, color: COLORS.faint }}>
                {totalRevFrom || totalRevTo
                  ? `${totalRevFrom ? fmtDate(new Date(totalRevFrom + "T00:00:00").getTime()) : "the beginning"} → ${totalRevTo ? fmtDate(new Date(totalRevTo + "T00:00:00").getTime()) : "today"}`
                  : "All time (no dates selected)"}
                {" "}· {totalRevRangeInvoices.length} paid invoice{totalRevRangeInvoices.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
            Contributing Payments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
            {totalRevRangeInvoices.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No paid invoices in this range.</div>}
            {totalRevRangeInvoices.map((inv) => {
              const PayIcon = PAY_ICON[inv.paymentMethod] || Banknote;
              return (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.border}`, flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>{inv.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {inv.customer}</span></div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint }}>{inv.jobId} · paid {fmtDate(inv.paidAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: COLORS.muted }}>
                    <PayIcon size={12} /> {inv.paymentMethod}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5, color: COLORS.teal }}>{fmtMoney(inv.total)}</div>
                  {onPrint && <Btn size="sm" variant="outline" onClick={() => onPrint(inv)}><Printer size={12} /></Btn>}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
function techMapName(technicians, id) { return technicians.find((t) => t.id === id)?.name || "—"; }

/* ---------------------------------------------------------------------- */
/*  FRONT DESK DASHBOARD                                                    */
/*  Today's pending orders lead the page; completed orders sit below.       */
/* ---------------------------------------------------------------------- */
function FrontDeskDashboard({ jobs, technicians, tick, onAssign, onPrintLabel, onSms, onWhatsApp, onCall, onAddJob, onAddCustomer, parts, onUpdate, onConfirmApproval, onDeclineApproval, onViewLiveTracking, liveLocations, smsLog, labelPrintEnforced = false, standbyLoans = [], onGiveStandby, onMarkStandbyReturned }) {
  const pending = sortByUrgency(jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status)));
  const pendingToday = pending.filter((j) => isSameDay(j.intake));
  const unassigned = pending.filter((j) => !j.assignedTech);
  const completed = jobs
    .filter((j) => ["ready_for_delivery", "delivered", "returned_unrepaired", "closed"].includes(j.status))
    .sort((a, b) => (b.updates[b.updates.length - 1]?.ts || 0) - (a.updates[a.updates.length - 1]?.ts || 0));
  const completedToday = completed.filter((j) => isSameDay(j.updates[j.updates.length - 1]?.ts || 0));
  const [showPendingList, setShowPendingList] = useState(false);
  const [detailJob, setDetailJob] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  useBackClose("fdd-showPendingList", showPendingList, () => setShowPendingList(false));
  useBackClose("fdd-detailJob", !!detailJob, () => setDetailJob(null));
  useBackClose("fdd-editingJob", !!editingJob, () => setEditingJob(null));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <AddCustomerButton onClick={onAddCustomer} />
        <AddJobButton onClick={onAddJob} />
      </div>

      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pending.length} sub="Tap to view the list" accent={COLORS.amber} onClick={() => setShowPendingList(true)} />
        <StatCard icon={Clock} label="Pending Today" value={pendingToday.length} sub="Intake received today" accent={COLORS.blue} />
        <StatCard icon={Users} label="Unassigned" value={unassigned.length} sub="Waiting on a technician" accent={COLORS.red} />
        <StatCard icon={CheckCircle2} label="Completed Today" value={completedToday.length} sub="Ready for billing / pickup" accent={COLORS.teal} />
        <StatCard icon={MapPin} label="Technician Locations" value={Object.keys(liveLocations || {}).length} sub="Tap to view live map" accent={COLORS.blue} onClick={onViewLiveTracking} />
      </div>

      {/* ---- Pending Orders (on top) ---- */}
      <Panel style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Pending Orders</div>
          <ClipboardList size={15} color={COLORS.faint} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pending.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No pending orders — bench is clear.</div>}
          {pending.map((j) => {
            return (
              <div key={j.id} style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "10px 4px", borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <span
                  onClick={() => setDetailJob(j)}
                  style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5, width: 78, cursor: "pointer", color: COLORS.amber }}
                >
                  {j.id}
                </span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{j.customer} <span style={{ color: COLORS.faint, fontWeight: 400 }}>— {j.brand} {j.model}</span></div>
                  <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
                    {timeAgo(j.intake, tick)}
                  </div>
                </div>
                <Badge status={j.status} />
                <StandbyLoanBadge loan={standbyLoans.find((l) => l.jobId === j.id && !l.returned)} tick={tick} onMarkReturned={onMarkStandbyReturned} />
                {j.assignedTech ? (
                  <span style={{ fontSize: 11.5, color: COLORS.muted, width: 120 }}>{techMapName(technicians, j.assignedTech)}</span>
                ) : (
                  <Select onChange={(e) => e.target.value && onAssign(j.id, e.target.value)} defaultValue="" style={{ width: 140 }}>
                    <option value="" disabled>Assign tech…</option>
                    {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                )}
                {onGiveStandby && STANDBY_ELIGIBLE_STATUSES.includes(j.status) && !standbyLoans.some((l) => l.jobId === j.id && !l.returned) && (
                  <Btn size="sm" variant="outline" onClick={() => onGiveStandby(j)}><Tv size={13} /></Btn>
                )}
                <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /></Btn>
                <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={13} /></Btn>
                <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /></Btn>
                <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={13} /> WhatsApp</Btn>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ---- Completed Orders (below) ---- */}
      <Panel style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Completed Orders</div>
          <CheckCircle2 size={15} color={COLORS.faint} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {completed.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No completed orders yet.</div>}
          {completed.map((j) => (
            <div key={j.id} className="rowhover data-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${COLORS.border}` }}>
              <span onClick={() => setDetailJob(j)} style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, width: 78, cursor: "pointer" }}>{j.id}</span>
              <span style={{ fontSize: 12.5, flex: 1 }}>{j.customer} — {j.brand} {j.model}</span>
              <span style={{ fontSize: 11.5, color: COLORS.faint, width: 130 }}>{j.assignedTech ? techMapName(technicians, j.assignedTech) : "Unassigned"}</span>
              <span style={{ fontSize: 11, color: COLORS.faint, width: 110 }}>{timeAgo(j.updates[j.updates.length - 1]?.ts || j.intake, tick)}</span>
              <Badge status={j.status} />
              <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /></Btn>
              <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={13} /></Btn>
              <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /></Btn>
              <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={13} /></Btn>
            </div>
          ))}
        </div>
      </Panel>

      {showPendingList && (
        <Modal title={`Pending Orders (${pending.length})`} onClose={() => setShowPendingList(false)} width={520}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No pending orders — bench is clear.</div>}
            {pending.map((j) => (
              <div
                key={j.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
                }}
              >
                <button
                  onClick={() => { setDetailJob(j); setShowPendingList(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{j.id}</span>
                  <span style={{ fontSize: 12.5, flex: 1, color: COLORS.muted }}>{j.customer} — {j.brand} {j.model}</span>
                  <Badge status={j.status} />
                  <ChevronRight size={15} color={COLORS.faint} />
                </button>
                <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={12} /></Btn>
                <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={12} /></Btn>
                <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={12} /></Btn>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {detailJob && (
        <Modal title={`${detailJob.id} — Job History`} onClose={() => setDetailJob(null)}>
          <JobDetail job={detailJob} technicians={technicians} onWhatsApp={onWhatsApp} onSms={onSms} onCall={onCall} onConfirmApproval={onConfirmApproval} onDeclineApproval={onDeclineApproval} smsLog={smsLog} />
          {detailJob.status !== "delivered" && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={() => { setEditingJob(detailJob); setDetailJob(null); }}>
                <Wrench size={14} /> Update Status
              </Btn>
              {onGiveStandby && STANDBY_ELIGIBLE_STATUSES.includes(detailJob.status) && !standbyLoans.some((l) => l.jobId === detailJob.id && !l.returned) && (
                <Btn variant="outline" onClick={() => { onGiveStandby(detailJob); setDetailJob(null); }}>
                  <Tv size={14} /> Give Standby TV
                </Btn>
              )}
            </div>
          )}
        </Modal>
      )}

      {editingJob && (
        <Modal title={`Update ${editingJob.id}`} onClose={() => setEditingJob(null)}>
          <UpdateJobForm
            job={editingJob} parts={parts} technicians={technicians} jobs={jobs}
            onSave={(payload) => { onUpdate(editingJob.id, payload); setEditingJob(null); }}
            onAssignTech={onAssign}
            onWhatsApp={onWhatsApp}
            labelPrintEnforced={labelPrintEnforced}
          />
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  NEW JOB FORM (Front Desk)                                              */
/* ---------------------------------------------------------------------- */
function NewJobForm({ onCreate, presetCustomer, customers = [], jobs = [], onSms, onWhatsApp }) {
  // Job type (indoor/outdoor) drives which prefix — JID or JOD — the Job ID
  // gets. Defaults to match the linked customer's type (CID → indoor,
  // COD → outdoor) but staff can override it from the dropdown.
  const [jobType, setJobType] = useState(presetCustomer?.customerType === "outdoor" ? "outdoor" : "indoor");
  // Reserve the Job ID the moment this form opens, so staff see exactly
  // which JID/JOD this intake will become before they even fill it in.
  const [previewId, setPreviewId] = useState(() => nextDailyId(jobType === "outdoor" ? "JOD" : "JID"));
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setPreviewId(nextDailyId(jobType === "outdoor" ? "JOD" : "JID"));
  }, [jobType]);
  const blank = {
    customer: presetCustomer?.name || "", phone: presetCustomer?.phone || "", location: presetCustomer?.location || "",
    brand: "", model: "", issue: "", accessories: "", estimate: "", fault: "", generalFault: "",
  };
  const [f, setF] = useState(blank);
  const [subFaults, setSubFaults] = useState([]);
  const [faultPhoto, setFaultPhoto] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState(presetCustomer?.customerId || "");
  const [voiceLang, setVoiceLang] = useState("en");
  const setVal = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));
  const setFault = (val) => setF((prev) => ({ ...prev, fault: val }));
  const valid = f.customer.trim() && f.phone.replace(/\D/g, "").length === 10 && f.brand.trim() && f.model.trim();

  const reset = () => {
    setF(blank);
    setSubFaults([]);
    setFaultPhoto(null);
    setSelectedCustomerId(presetCustomer?.customerId || "");
    const nextType = presetCustomer?.customerType === "outdoor" ? "outdoor" : "indoor";
    setJobType(nextType);
    setPreviewId(nextDailyId(nextType === "outdoor" ? "JOD" : "JID"));
  };

  const lastJobFor = (customerId) =>
    jobs.filter((j) => j.customerId === customerId).sort((a, b) => b.intake - a.intake)[0];

  const sortedCustomers = [...customers].sort((a, b) => b.createdAt - a.createdAt);

  function handleSelectCustomer(customerId) {
    setSelectedCustomerId(customerId);
    if (!customerId) return;
    const cust = customers.find((c) => c.customerId === customerId);
    if (!cust) return;
    if (cust.customerType) setJobType(cust.customerType === "outdoor" ? "outdoor" : "indoor");
    const last = lastJobFor(customerId);
    setF((prev) => ({
      ...prev,
      customer: cust.name || prev.customer,
      phone: cust.phone || prev.phone,
      location: cust.location || prev.location,
      brand: last?.brand || prev.brand,
      model: last?.model || prev.model,
      issue: last?.issue || prev.issue,
      fault: last?.fault || prev.fault,
    }));
    if (last?.subFaults) setSubFaults(last.subFaults);
  }

  return (
    <Panel style={{ padding: 22, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <Plus size={17} color={COLORS.amber} />
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>New Job Card — Intake</div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18,
        padding: "12px 16px", borderRadius: 10, background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`,
      }}>
        <span style={{ fontSize: 11, color: COLORS.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>New Job ID</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 18, letterSpacing: 0.5, color: COLORS.amber }}>{previewId}</span>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Field label="Job Type">
          <Select value={jobType} onChange={(e) => setJobType(e.target.value)}>
            <option value="indoor">Indoor Job (JID)</option>
            <option value="outdoor">Outdoor Job (JOD)</option>
          </Select>
        </Field>
      </div>

      {sortedCustomers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Field label="Select Existing Customer (CID) — auto-fills name, phone, TV model &amp; fault">
            <Select value={selectedCustomerId} onChange={(e) => handleSelectCustomer(e.target.value)}>
              <option value="">— New / Walk-in Customer —</option>
              {sortedCustomers.map((c) => {
                const last = lastJobFor(c.customerId);
                const lastBit = last ? ` — last: ${last.brand} ${last.model} (${last.fault})` : "";
                return (
                  <option key={c.customerId} value={c.customerId}>
                    {c.customerId} — {c.name || "Unnamed"} — {c.phone}{lastBit}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>
      )}

      {selectedCustomerId && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "9px 12px",
          background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 8,
        }}>
          <Phone size={13} color={COLORS.teal} />
          <span style={{ fontSize: 12, color: COLORS.text }}>
            Converting <strong style={{ fontFamily: FONT_MONO }}>{selectedCustomerId}</strong> to a job card — this JID will stay linked to that CID. Fields below were pre-filled — double-check before saving.
          </span>
        </div>
      )}

      <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Customer Name — tap the mic to speak">
          <VoiceInput value={f.customer} onChange={setVal("customer")} placeholder="e.g. Anitha Raman" lang={voiceLang} onLangChange={setVoiceLang} />
        </Field>
        <Field label="Phone Number — tap the mic to speak the number">
          <VoiceInput value={f.phone} onChange={setVal("phone")} placeholder="98432 11001" lang="en" numeric phoneFormat />
        </Field>
        <Field label="TV Brand — tap the mic to speak">
          <VoiceInput value={f.brand} onChange={setVal("brand")} placeholder="e.g. Samsung, LG, Sony" lang={voiceLang} />
        </Field>
        <Field label="Model Number — tap the mic to speak">
          <VoiceInput value={f.model} onChange={setVal("model")} placeholder="e.g. UA43T5350" lang={voiceLang} />
        </Field>
        <Field label="Accessories Brought — tap the mic to speak">
          <VoiceInput value={f.accessories} onChange={setVal("accessories")} placeholder="Remote, cable, stand…" lang={voiceLang} />
        </Field>
        <Field label="Estimated Cost (₹) — tap the mic to speak the amount">
          <VoiceInput value={f.estimate} onChange={setVal("estimate")} placeholder="Optional" lang="en" numeric type="number" />
        </Field>
        <Field label="Location — tap the mic to speak">
          <VoiceInput value={f.location} onChange={setVal("location")} placeholder="e.g. RS Puram, Coimbatore" lang={voiceLang} />
        </Field>
        <Field label="General Fault (optional)">
          <Select value={f.generalFault} onChange={(e) => setVal("generalFault")(e.target.value)}>
            <option value="">— Select —</option>
            {GENERAL_FAULT_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Reported Issue (optional) — tap the mic to speak">
          <VoiceInput value={f.issue} onChange={setVal("issue")} placeholder="Describe the fault as reported by customer…" lang={voiceLang} multiline />
        </Field>
      </div>
      <div style={{ marginTop: 16 }}>
        <FaultSelector fault={f.fault} setFault={setFault} subFaults={subFaults} setSubFaults={setSubFaults} allowNone />
      </div>
      <div style={{ marginTop: 16 }}>
        <PhotoUploadField label="Fault Photo" value={faultPhoto} onChange={setFaultPhoto} />
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn
          disabled={!valid}
          onClick={() => { onCreate({ ...f, id: previewId, jobType, estimate: Number(f.estimate) || 0, subFaults, faultPhoto, customerId: selectedCustomerId || null }); reset(); }}
        >
          <Plus size={14} /> Create Job Card &amp; Send SMS
        </Btn>
        {onSms && (
          <Btn
            variant="outline" disabled={!f.customer.trim() || f.phone.replace(/\D/g, "").length < 10}
            onClick={() => onSms({ id: previewId, customer: f.customer, phone: f.phone, brand: f.brand, model: f.model, status: DEFAULT_STATUS, fault: f.fault, subFaults })}
          >
            <MessageSquare size={14} /> Send SMS
          </Btn>
        )}
        {onWhatsApp && (
          <Btn
            variant="teal" disabled={!f.customer.trim() || f.phone.replace(/\D/g, "").length < 10}
            onClick={() => onWhatsApp({ id: previewId, customer: f.customer, phone: f.phone, brand: f.brand, model: f.model, status: DEFAULT_STATUS, fault: f.fault, subFaults })}
          >
            <MessageSquare size={14} /> Send WhatsApp Update
          </Btn>
        )}
        <Btn variant="outline" onClick={reset}>Clear</Btn>
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.faint }}>
        Creating a job card automatically sends an SMS confirmation to the customer with their Job ID, and starts
        the automated 2-hour reminder cycle (based on the default fault selected above) until the job is marked Completed.
        The Send SMS / WhatsApp buttons let you message the customer with the reserved Job ID before saving, if needed.
      </div>
    </Panel>
  );
}

/* Small chip row showing the main fault category + each checked
   sub-section — used anywhere a job is listed so status tracking shows
   both at a glance. */
function FaultTags({ job }) {
  if (!job.fault && !job.generalFault && (!job.subFaults || job.subFaults.length === 0)) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {job.generalFault && (
        <span style={{ fontSize: 10.5, fontFamily: FONT_MONO, background: COLORS.redDim, color: COLORS.red, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
          {job.generalFault}
        </span>
      )}
      {job.fault && (
        <span style={{ fontSize: 10.5, fontFamily: FONT_MONO, background: COLORS.amberDim, color: COLORS.amber, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
          {job.fault}
        </span>
      )}
      {(job.subFaults || []).map((sf) => (
        <span key={sf} style={{ fontSize: 10.5, background: COLORS.panel2, color: COLORS.teal, padding: "2px 8px", borderRadius: 999, border: `1px solid ${COLORS.border}` }}>
          {sf}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  JOB CARDS LIST (Admin + Front Desk)                                    */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  CUSTOMERS VIEW — the CID layer. Every enquiry/call becomes a customer  */
/*  record here first; "+ Create Job" is the one-click CID → JID           */
/*  conversion described in the Android Call Launcher architecture doc.    */
/*  (Real incoming-call detection and the system overlay only exist in     */
/*  the native Android app — "Log Call / New Enquiry" is this web app's    */
/*  manual equivalent for phone enquiries taken at the counter.)           */
/* ---------------------------------------------------------------------- */
function CustomersView({ customers, jobs, tick, role, onLogCall, onAddNote, onCreateJob, onWhatsApp, onSms, onCall, onRequestDelete, onUpdateLocation, smsLog = [] }) {
  const [q, setQ] = useState("");
  const [logging, setLogging] = useState(false);
  const [detail, setDetail] = useState(null);

  const sorted = [...customers].sort((a, b) => b.createdAt - a.createdAt);
  const filtered = sorted.filter((c) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return c.customerId.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || c.phone.includes(q);
  });

  const jobsFor = (customerId) => jobs.filter((j) => j.customerId === customerId);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>Customers (CID)</div>
          <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 2 }}>Every enquiry becomes a CID first — convert to a job only once the customer commits.</div>
        </div>
        <Btn onClick={() => setLogging(true)}><Phone size={13} /> Add Customer</Btn>
      </div>

      <div style={{ position: "relative", marginBottom: 16, maxWidth: 420 }}>
        <Search size={14} color={COLORS.faint} style={{ position: "absolute", left: 11, top: 11 }} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by CID, name, or phone…" style={{ paddingLeft: 32 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && <div style={{ color: COLORS.faint, fontSize: 13 }}>No customers match.</div>}
        {filtered.map((c) => {
          const linkedJobs = jobsFor(c.customerId);
          const isLead = c.status === "Enquiry / Lead";
          return (
            <Panel key={c.customerId} style={{ padding: 15 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{c.customerId}</span>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, padding: "2px 8px", borderRadius: 999,
                      color: isLead ? COLORS.amber : COLORS.teal, background: isLead ? COLORS.amberDim : COLORS.tealDim,
                    }}>
                      {c.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name || <span style={{ color: COLORS.faint, fontWeight: 400 }}>Name not captured yet</span>} <span style={{ color: COLORS.faint, fontWeight: 400 }}>· {c.phone}</span></div>
                  {c.location && (
                    <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}><strong>Location:</strong> {c.location}</div>
                  )}
                  <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}>
                    {c.source} · {timeAgo(c.createdAt, tick)} · {linkedJobs.length} job{linkedJobs.length === 1 ? "" : "s"} on file
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <Btn size="sm" variant="outline" onClick={() => onCall(c)}><Phone size={13} /> Call</Btn>
                  <Btn size="sm" variant="outline" onClick={() => onSms(c)}><MessageSquare size={13} /> SMS</Btn>
                  <Btn size="sm" variant="teal" onClick={() => onWhatsApp(c)}><MessageSquare size={13} /> WhatsApp</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setDetail(c)}>Details</Btn>
                  <Btn size="sm" onClick={() => onCreateJob(c)}><Plus size={13} /> Create Job</Btn>
                  {role === "admin" && (
                    <Btn size="sm" variant="danger" onClick={() => onRequestDelete(c)} title="Delete this CID">
                      <Trash2 size={13} />
                    </Btn>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {logging && (
        <Modal title="Add Customer" onClose={() => setLogging(false)} width={440}>
          <LogCallForm
            customers={customers}
            jobs={jobs}
            smsLog={smsLog}
            onSubmit={(data) => { onLogCall(data); setLogging(false); }}
            onCancel={() => setLogging(false)}
            onViewCustomer={(customer) => { setDetail(customer); setLogging(false); }}
            onCreateJob={(customer) => { onCreateJob(customer); setLogging(false); }}
          />
        </Modal>
      )}

      {detail && (
        <Modal title={`${detail.customerId} — ${detail.name || "Unnamed caller"}`} onClose={() => setDetail(null)} width={520}>
          <CustomerDetail
            customer={detail} jobs={jobsFor(detail.customerId)} tick={tick}
            onAddNote={(note) => onAddNote(detail.customerId, note)}
            onCreateJob={() => { onCreateJob(detail); setDetail(null); }}
            onWhatsApp={() => onWhatsApp(detail)}
            onSms={() => onSms(detail)}
            onCall={() => onCall(detail)}
            onDelete={role === "admin" ? () => { onRequestDelete(detail); setDetail(null); } : null}
            onUpdateLocation={(loc) => { onUpdateLocation(detail.customerId, loc); setDetail((d) => (d ? { ...d, currentLocation: loc } : d)); }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  VOICE-TO-TEXT INPUT — wraps the browser's Web Speech API (available    */
/*  in Chrome/Android WebView) behind a mic button next to a normal text   */
/*  input. Tap the mic, speak in Tamil or English, and the recognized      */
/*  text is appended to the field. Falls back to a plain input with the    */
/*  mic hidden if the browser doesn't support SpeechRecognition (e.g.      */
/*  desktop Safari, some in-app WebViews).                                 */
/* ---------------------------------------------------------------------- */
/* Minimal phone-entry form standing in for real caller-ID detection —
   see the note in the modal above about what a native Android app would
   do here instead (CallScreeningService reading the number automatically). */
function SimulateCallForm({ onTrigger }) {
  const [phone, setPhone] = useState("");
  const valid = phone.replace(/\D/g, "").length >= 10;
  return (
    <div>
      <Field label="Incoming Number">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" autoFocus />
      </Field>
      <Btn style={{ marginTop: 14, width: "100%" }} disabled={!valid} onClick={() => onTrigger(phone)}>
        <Phone size={14} /> Simulate Call From This Number
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  INCOMING CALL POPUP — the caller-ID screen. Known number → CID, name,  */
/*  location, and their current/most recent Job ID + TV status right on   */
/*  screen. Unknown number → a quick "not in CRM yet" form that creates    */
/*  the CID (with name + location) the moment it's saved.                 */
/* ---------------------------------------------------------------------- */
function IncomingCallPopup({ phone, customer, jobs, onClose, onCreateCustomer, onCall, onViewCustomer, onCreateJob }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  if (customer) {
    const customerJobs = jobs.filter((j) => j.customerId === customer.customerId).sort((a, b) => b.intake - a.intake);
    const currentJob = customerJobs.find((j) => ACTIVE_JOB_STATUSES.includes(j.status)) || customerJobs[0];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, padding: "12px 14px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 9 }}>
          <CheckCircle2 size={18} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
            Registered customer — <strong style={{ fontFamily: FONT_MONO }}>{phone}</strong>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18, fontSize: 12.5 }} className="form-grid-2col">
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: COLORS.faint }}>Name:</span> <strong>{customer.name || "Not on file"}</strong>
          </div>
          <div><span style={{ color: COLORS.faint }}>CID:</span> <span style={{ fontFamily: FONT_MONO, fontWeight: 700 }}>{customer.customerId}</span></div>
          <div><span style={{ color: COLORS.faint }}>Location:</span> {customer.location || "—"}</div>
          {currentJob ? (
            <>
              <div><span style={{ color: COLORS.faint }}>JID:</span> <span style={{ fontFamily: FONT_MONO, fontWeight: 700 }}>{currentJob.id}</span></div>
              <div><span style={{ color: COLORS.faint }}>TV Status:</span> <Badge status={currentJob.status} /></div>
              <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Device:</span> {currentJob.brand} {currentJob.model}</div>
            </>
          ) : (
            <div style={{ gridColumn: "1 / -1", color: COLORS.faint }}>No job on file yet for this customer.</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="outline" onClick={onCall}><Phone size={13} /> Call Back</Btn>
          <Btn variant="outline" onClick={() => onViewCustomer(customer)}>View Customer</Btn>
          <Btn variant="teal" onClick={() => onCreateJob(customer)}><Plus size={13} /> Create New Job</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, padding: "12px 14px", background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
        <AlertTriangle size={18} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.5 }}>
          New number — <strong style={{ fontFamily: FONT_MONO }}>{phone}</strong> is not in the CRM yet. Save it as a new customer?
        </div>
      </div>
      <Field label="Customer Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakshmi Narayanan" autoFocus />
      </Field>
      <div style={{ height: 12 }} />
      <Field label="Location">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. RS Puram, Coimbatore" />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn onClick={() => onCreateCustomer({ phone, name, location, source: "Incoming Call" })}>
          <Plus size={13} /> Save as New Customer
        </Btn>
        <Btn variant="outline" onClick={onClose}>Dismiss</Btn>
      </div>
    </div>
  );
}

/* Converts a speech-recognition transcript into a digit string — handles
   both literal numerals ("9843211001") and spoken digit words ("nine eight
   four three...", including "oh"/"o" for zero), which is how many mobile
   browsers transcribe a rattled-off phone number. */
function speechToDigits(transcript) {
  const WORD_DIGITS = {
    zero: "0", oh: "0", o: "0", one: "1", won: "1", two: "2", to: "2", too: "2",
    three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  };
  const tokens = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  let digits = "";
  for (const t of tokens) {
    if (/^\d+$/.test(t)) digits += t;
    else if (WORD_DIGITS[t]) digits += WORD_DIGITS[t];
  }
  return digits;
}

/* Formats a 10-digit phone number as "XXXXX XXXXX" — first five digits,
   a space, then the remaining five. Strips anything already typed that
   isn't a digit and caps at 10 digits before formatting, so it's safe to
   run on every keystroke or voice-merge without double-inserting spaces. */
function formatPhoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 10);
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function VoiceInput({ value, onChange, placeholder, lang, onLangChange, numeric, maxLength, autoFocus, multiline, type, phoneFormat }) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const SpeechRecognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const effectiveMaxLength = phoneFormat ? 11 : maxLength;

  function toggleListen() {
    if (!SpeechRecognition) return;
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const recog = new SpeechRecognition();
    recog.lang = lang === "ta" ? "ta-IN" : "en-IN";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (e) => {
      const heard = e.results[0][0].transcript;
      if (numeric) {
        const digits = speechToDigits(heard);
        const merged = (value || "").replace(/\D/g, "") + digits;
        onChange(phoneFormat ? formatPhoneDigits(merged) : (maxLength ? merged.slice(0, maxLength) : merged));
      } else {
        onChange((value ? value + " " : "") + heard);
      }
    };
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    recogRef.current = recog;
    setListening(true);
    recog.start();
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: multiline ? "flex-start" : "center" }}>
      {multiline ? (
        <TextArea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
      ) : (
        <Input
          type={type} value={value}
          onChange={(e) => onChange(phoneFormat ? formatPhoneDigits(e.target.value) : e.target.value)}
          placeholder={placeholder} style={{ flex: 1 }} autoFocus={autoFocus} maxLength={effectiveMaxLength}
        />
      )}
      {onLangChange && (
        <Select value={lang} onChange={(e) => onLangChange(e.target.value)} style={{ width: 76, flexShrink: 0, padding: "9px 6px", fontSize: 12 }}>
          <option value="en">EN</option>
          <option value="ta">TA</option>
        </Select>
      )}
      {SpeechRecognition && (
        <button
          type="button" onClick={toggleListen} title={listening ? "Listening… tap to stop" : "Tap to speak"}
          style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: 7, border: `1px solid ${listening ? COLORS.red : COLORS.border}`,
            background: listening ? COLORS.redDim : COLORS.panel2, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Mic size={15} color={listening ? COLORS.red : COLORS.muted} />
        </button>
      )}
    </div>
  );
}

function LogCallForm({ customers, jobs = [], smsLog = [], onSubmit, onCancel, onViewCustomer, onCreateJob }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [voiceLang, setVoiceLang] = useState("en");
  const [customerType, setCustomerType] = useState("indoor");
  const [showJobs, setShowJobs] = useState(false);

  const digits = phone.replace(/\D/g, "");
  const lengthError = digits.length > 0 && digits.length !== 10 ? "Phone number must be exactly 10 digits." : null;
  const existing = digits.length === 10 ? customers.find((c) => c.phone.replace(/\D/g, "") === digits) : null;
  const existingJobs = existing ? jobs.filter((j) => j.customerId === existing.customerId).sort((a, b) => b.intake - a.intake) : [];
  const valid = digits.length === 10 && !existing;

  // Recent call log — incoming or outgoing — pulled from the shared call/
  // SMS log (every call action logs a "[Call] ..." entry there, newest
  // first), so front desk can pick a number instead of retyping it.
  // Deduped by phone number, most-recent call per number kept, capped
  // to a short list so the picker stays scannable.
  const [showCallLog, setShowCallLog] = useState(false);
  const recentCalls = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const l of smsLog) {
      if (!l.message || !l.message.startsWith("[Call]") || !l.phone) continue;
      const d = l.phone.replace(/\D/g, "");
      if (seen.has(d)) continue;
      seen.add(d);
      const match = customers.find((c) => c.phone.replace(/\D/g, "") === d);
      out.push({
        phone: l.phone,
        ts: l.ts,
        direction: l.message.startsWith("[Call] Incoming") ? "incoming" : "outgoing",
        name: match?.name || null,
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [smsLog, customers]);

  return (
    <div>
      <Field label="Phone Number — tap the mic to speak the number">
        <VoiceInput value={phone} onChange={setPhone} placeholder="98432 11001" lang="en" numeric phoneFormat autoFocus />
      </Field>
      {recentCalls.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowCallLog((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "none",
              border: `1px dashed ${COLORS.border}`, borderRadius: 7, padding: "6px 10px",
              cursor: "pointer", fontSize: 11.5, color: COLORS.blue, fontWeight: 600,
            }}
          >
            <Phone size={12} /> {showCallLog ? "Hide" : "Select from Recent Calls"} ({recentCalls.length})
          </button>

          {showCallLog && (
            <div style={{
              marginTop: 8, border: `1px solid ${COLORS.border}`, borderRadius: 8,
              maxHeight: 220, overflowY: "auto", background: COLORS.panel,
            }}>
              {recentCalls.map((c, i) => (
                <button
                  key={c.phone + i}
                  type="button"
                  onClick={() => { setPhone(formatPhoneDigits(c.phone)); setShowCallLog(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 8, background: "none", border: "none",
                    borderBottom: i < recentCalls.length - 1 ? `1px solid ${COLORS.border}` : "none",
                    padding: "9px 12px", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Phone
                      size={12}
                      color={c.direction === "incoming" ? COLORS.teal : COLORS.blue}
                      style={{ flexShrink: 0, transform: c.direction === "incoming" ? "rotate(135deg)" : "none" }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: FONT_MONO, color: COLORS.text }}>
                        {formatPhoneDigits(c.phone)}
                      </div>
                      {c.name && <div style={{ fontSize: 11, color: COLORS.muted }}>{c.name}</div>}
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: COLORS.faint, flexShrink: 0 }}>{timeAgo(c.ts)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {lengthError && (
        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.red, fontWeight: 600 }}>{lengthError}</div>
      )}

      {existing ? (
        <div style={{ marginTop: 12, padding: "12px 12px", background: COLORS.redDim, border: `1px solid ${COLORS.red}55`, borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={14} color={COLORS.red} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>
              Phone number already exists — <strong style={{ fontFamily: FONT_MONO }}>{existing.customerId}</strong> ({existing.name || "name not on file"}). A customer can't be added twice with the same number.
            </div>
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
            {onViewCustomer && (
              <Btn size="sm" variant="outline" onClick={() => onViewCustomer(existing)}>
                <UserCircle2 size={13} /> Use Existing Customer ({existing.customerId})
              </Btn>
            )}
            <Btn size="sm" variant="outline" onClick={() => setShowJobs((v) => !v)}>
              <ClipboardList size={13} /> {showJobs ? "Hide" : "View"} Job List ({existingJobs.length})
            </Btn>
            {onCreateJob && (
              <Btn size="sm" variant="teal" onClick={() => onCreateJob(existing)}>
                <Plus size={13} /> Add New Job
              </Btn>
            )}
          </div>

          {showJobs && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {existingJobs.length === 0 && (
                <div style={{ fontSize: 12, color: COLORS.faint }}>No job cards on file for this customer yet.</div>
              )}
              {existingJobs.map((j) => (
                <div key={j.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "7px 10px", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 7,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>{j.id}</span>
                    <span style={{ fontSize: 11.5, color: COLORS.muted, marginLeft: 8 }}>{j.brand} {j.model}</span>
                  </div>
                  <Badge status={j.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <Field label="Customer Type">
              <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
                <option value="indoor">Indoor Customer (CID)</option>
                <option value="outdoor">Outdoor Customer (COD)</option>
              </Select>
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Customer Name (optional if unknown yet) — tap the mic to speak">
              <VoiceInput value={name} onChange={setName} placeholder="e.g. Lakshmi Narayanan" lang={voiceLang} onLangChange={setVoiceLang} />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Location — tap the mic to speak">
              <VoiceInput value={location} onChange={setLocation} placeholder="e.g. RS Puram, Coimbatore" lang={voiceLang} />
            </Field>
          </div>
        </>
      )}

      {!existing && (
        <div style={{ marginTop: 12 }}>
          <Field label="Remarks (optional)">
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked about backlight repair cost for a 43&quot; Samsung…" />
          </Field>
        </div>
      )}

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <Btn disabled={!valid} onClick={() => onSubmit({ phone, name, location, note, customerType })}>
          <Phone size={13} /> Add Customer
        </Btn>
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function CustomerDetail({ customer, jobs, tick, onAddNote, onCreateJob, onWhatsApp, onSms, onCall, onDelete, onUpdateLocation }) {
  const [note, setNote] = useState("");
  const [pastingLocation, setPastingLocation] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const parsedLocation = parseLatLngFromText(locationInput);

  const requestLocationViaWhatsApp = () => {
    const message = `Hi ${customer.name || "there"}, could you please share your current location with us on WhatsApp? Tap the attachment (📎) icon and choose "Location" → "Send your current location". This helps us assign the nearest technician for your service.`;
    window.open(waLink(customer.phone, message), "_blank", "noopener,noreferrer");
  };

  const saveLocation = () => {
    if (!parsedLocation) return;
    onUpdateLocation(parsedLocation);
    setLocationInput("");
    setPastingLocation(false);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Btn size="sm" variant="outline" onClick={onCall}>
          <Phone size={13} /> Call Now
        </Btn>
        <Btn size="sm" variant="outline" onClick={onSms}>
          <MessageSquare size={13} /> Send SMS Update
        </Btn>
        <Btn size="sm" variant="teal" onClick={onWhatsApp}>
          <MessageSquare size={13} /> Send WhatsApp Update
        </Btn>
        {onDelete && (
          <Btn size="sm" variant="danger" onClick={onDelete}>
            <Trash2 size={13} /> Delete CID
          </Btn>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
        <div><span style={{ color: COLORS.faint }}>Phone:</span> {customer.phone}</div>
        <div><span style={{ color: COLORS.faint }}>Source:</span> {customer.source}</div>
        <div><span style={{ color: COLORS.faint }}>Status:</span> {customer.status}</div>
        <div><span style={{ color: COLORS.faint }}>First contact:</span> {fmtDateTime(customer.createdAt)}</div>
        <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Location:</span> {customer.location || "—"}</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={{ color: COLORS.faint }}>GPS Location:</span>{" "}
          {customer.currentLocation ? (
            <a href={mapsLink(customer.currentLocation)} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.blue }}>view on map</a>
          ) : (
            <span style={{ color: COLORS.faint }}>not captured yet</span>
          )}
        </div>
      </div>

      {onUpdateLocation && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
            Update Current Location
          </div>
          {!pastingLocation ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn size="sm" variant="teal" onClick={requestLocationViaWhatsApp}>
                <MessageSquare size={13} /> Request Location via WhatsApp
              </Btn>
              <Btn size="sm" variant="outline" onClick={() => setPastingLocation(true)}>
                <MapPin size={13} /> Paste Location Link
              </Btn>
            </div>
          ) : (
            <div>
              <Input
                value={locationInput} onChange={(e) => setLocationInput(e.target.value)}
                placeholder="Paste the Google Maps / WhatsApp location link the customer sent…" autoFocus
              />
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <Btn size="sm" disabled={!parsedLocation} onClick={saveLocation}>
                  <CheckCircle2 size={13} /> Save Location
                </Btn>
                <Btn size="sm" variant="outline" onClick={() => { setPastingLocation(false); setLocationInput(""); }}>Cancel</Btn>
              </div>
              {locationInput && !parsedLocation && (
                <div style={{ fontSize: 11, color: COLORS.red, marginTop: 6 }}>
                  Couldn't find coordinates in that — paste the full Google Maps link WhatsApp generated.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
        Linked Jobs ({jobs.length})
      </div>
      {jobs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: COLORS.faint, marginBottom: 16 }}>No job created yet from this CID.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {jobs.map((j) => (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "8px 10px", background: COLORS.panel2, borderRadius: 7 }}>
              <span style={{ fontFamily: FONT_MONO }}>{j.id}</span>
              <span style={{ color: COLORS.muted }}>{j.brand} {j.model}</span>
              <Badge status={j.status} />
            </div>
          ))}
        </div>
      )}

      <Btn size="sm" onClick={onCreateJob} style={{ marginBottom: 18 }}><Plus size={13} /> Create Another Job</Btn>

      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
        Call / Enquiry Notes
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" style={{ flex: 1 }} />
        <Btn size="sm" onClick={() => { if (note.trim()) { onAddNote(note); setNote(""); } }}>Add</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {customer.notes.length === 0 && <div style={{ fontSize: 12, color: COLORS.faint }}>No notes yet.</div>}
        {customer.notes.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.amber, marginTop: 5, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12.5 }}><strong>{n.by}</strong> — {n.note}</div>
              <div style={{ fontSize: 11, color: COLORS.faint }}>{fmtDateTime(n.ts)} · {timeAgo(n.ts, tick)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobCardsList({ jobs, technicians, role, tick, onPrintLabel, onAssign, onSms, onWhatsApp, onCall, onRequestDelete, onUpdate, onConfirmApproval, onDeclineApproval, onRequestUpdate, parts, smsLog = [], labelPrintEnforced = false, standbyLoans = [], onGiveStandby, onMarkStandbyReturned }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  useBackClose("jcl-detail", !!detail, () => setDetail(null));
  useBackClose("jcl-editing", !!editing, () => setEditing(null));

  const filtered = sortByUrgency(
    jobs.filter((j) => {
      const matchQ = !q || `${j.id} ${j.customer} ${j.phone} ${j.brand} ${j.model}`.toLowerCase().includes(q.toLowerCase());
      const matchS = statusFilter === "All" || j.status === statusFilter;
      return matchQ && matchS;
    })
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={14} color={COLORS.faint} style={{ position: "absolute", left: 11, top: 11 }} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by job ID, customer, phone, model…" style={{ paddingLeft: 32 }} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 210 }}>
          <option value="All">All Statuses</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && <div style={{ color: COLORS.faint, fontSize: 13 }}>No job cards match.</div>}
        {filtered.map((j) => {
          const inSpareWait = j.spareWaitUntil && Date.now() < j.spareWaitUntil;
          const overdue = ACTIVE_JOB_STATUSES.includes(j.status) && Date.now() - j.intake > 2 * H && !inSpareWait;
          const daysLeft = inSpareWait ? Math.max(1, Math.ceil((j.spareWaitUntil - Date.now()) / (24 * H))) : 0;
          const msgCount = smsLog.filter((m) => m.jobId === j.id).length;
          return (
            <Panel key={j.id} style={{ padding: 15, borderColor: overdue ? `${COLORS.red}66` : COLORS.border }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{j.id}</span>
                    <Badge status={j.status} />
                    {msgCount > 0 && (
                      <span style={{ fontSize: 10.5, fontFamily: FONT_MONO, color: COLORS.muted, display: "flex", alignItems: "center", gap: 3 }}>
                        <MessageSquare size={11} /> {msgCount} sent
                      </span>
                    )}
                    {j.customerId && (
                      <span style={{ fontSize: 10.5, fontFamily: FONT_MONO, color: COLORS.faint }}>← {j.customerId}</span>
                    )}
                    {inSpareWait && (
                      <span style={{ fontSize: 10.5, color: COLORS.blue, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 3 }}>
                        <Clock size={11} /> spare wait — {daysLeft}d left · daily check-in
                      </span>
                    )}
                    {overdue && <span style={{ fontSize: 10.5, color: COLORS.red, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={11} /> overdue</span>}
                    <StandbyLoanBadge loan={standbyLoans.find((l) => l.jobId === j.id && !l.returned)} tick={tick} onMarkReturned={onMarkStandbyReturned} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{j.customer} <span style={{ color: COLORS.faint, fontWeight: 400 }}>· {j.phone}</span></div>
                  <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{j.brand} {j.model} — {j.issue}</div>
                  {j.location && (
                    <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}><strong>Location:</strong> {j.location}</div>
                  )}
                  <FaultTags job={j} />
                  <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 4 }}>
                    Intake {fmtDateTime(j.intake)} · {timeAgo(j.intake, tick)} · Tech: {technicians.find((t) => t.id === j.assignedTech)?.name || "Unassigned"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {(role === "admin" || role === "frontdesk") && !j.assignedTech && (
                    <Select onChange={(e) => e.target.value && onAssign(j.id, e.target.value)} defaultValue="" style={{ width: 150 }}>
                      <option value="" disabled>Assign tech…</option>
                      {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  )}
                  {(role === "admin" || role === "frontdesk") && onGiveStandby && STANDBY_ELIGIBLE_STATUSES.includes(j.status) && !standbyLoans.some((l) => l.jobId === j.id && !l.returned) && (
                    <Btn size="sm" variant="outline" onClick={() => onGiveStandby(j)}><Tv size={13} /> Standby TV</Btn>
                  )}
                  <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /> Label</Btn>
                  <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={13} /> Call</Btn>
                  <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /> SMS</Btn>
                  <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={13} /> WhatsApp</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setDetail(j)}>Details</Btn>
                  {j.assignedTech && ACTIVE_JOB_STATUSES.includes(j.status) && (
                    <Btn
                      size="sm" variant="outline" disabled={!!j.updateRequested}
                      onClick={() => onRequestUpdate(j.id)}
                      title={j.updateRequested ? "Already requested — waiting on the technician" : "Ask the assigned technician for a current status update"}
                    >
                      <RefreshCw size={13} /> {j.updateRequested ? "Update Requested" : "Request Update"}
                    </Btn>
                  )}
                  {j.status !== "closed" && (
                    <Btn size="sm" onClick={() => setEditing(j)}><Wrench size={13} /> Update</Btn>
                  )}
                  {role === "admin" && (
                    <Btn size="sm" variant="danger" onClick={() => onRequestDelete(j)} title="Delete job record">
                      <Trash2 size={13} />
                    </Btn>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {detail && (
        <Modal title={`${detail.id} — Job History`} onClose={() => setDetail(null)}>
          <JobDetail job={detail} technicians={technicians} onWhatsApp={onWhatsApp} onSms={onSms} onCall={onCall} onConfirmApproval={onConfirmApproval} onDeclineApproval={onDeclineApproval} smsLog={smsLog} />
        </Modal>
      )}

      {editing && (
        <Modal title={`Update ${editing.id}`} onClose={() => setEditing(null)}>
          <UpdateJobForm
            job={editing} parts={parts} technicians={technicians} jobs={jobs}
            onSave={(payload) => { onUpdate(editing.id, payload); setEditing(null); }}
            onAssignTech={onAssign}
            onWhatsApp={onWhatsApp}
            labelPrintEnforced={labelPrintEnforced}
          />
        </Modal>
      )}
    </div>
  );
}

function messageChannel(message) {
  if (message.startsWith("[WhatsApp]")) return "WhatsApp";
  if (message.startsWith("[Call]")) return "Call";
  return "SMS";
}

function JobDetail({ job, technicians, onWhatsApp, onSms, onCall, onConfirmApproval, onDeclineApproval, smsLog = [] }) {
  const jobMessages = [...smsLog].filter((m) => m.jobId === job.id).sort((a, b) => b.ts - a.ts);
  const counts = jobMessages.reduce(
    (acc, m) => { const ch = messageChannel(m.message); acc[ch] = (acc[ch] || 0) + 1; return acc; },
    { SMS: 0, WhatsApp: 0, Call: 0 }
  );
  const channelStyle = { SMS: COLORS.blue, WhatsApp: COLORS.teal, Call: COLORS.amber };

  return (
    <div>
      {job.approvalStage === "pending_review" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16, padding: "10px 12px", background: `${COLORS.amber}1c`, border: `1px solid ${COLORS.amber}55`, borderRadius: 8 }}>
          <Wrench size={14} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>
            Technician submitted a diagnosis and is awaiting review.
            {job.repairRemarks && <><br /><span style={{ color: COLORS.muted }}>"{job.repairRemarks}"</span></>}
            <br /><span style={{ color: COLORS.muted }}>Set an estimate from the bell icon's Repair Requests menu.</span>
          </div>
        </div>
      )}
      {job.approvalStage === "awaiting_customer" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16, padding: "10px 12px", background: `${COLORS.blue}1c`, border: `1px solid ${COLORS.blue}55`, borderRadius: 8 }}>
          <Clock size={14} color={COLORS.blue} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4, flex: 1 }}>
            Quote sent — repair {fmtMoney(job.estimate || 0)} + service {fmtMoney(job.serviceCharge || 0)} = <strong>{fmtMoney((job.estimate || 0) + (job.serviceCharge || 0))}</strong>. Awaiting the customer's OK to proceed.
            {job.repairRemarks && <><br /><span style={{ color: COLORS.muted }}>"{job.repairRemarks}"</span></>}
            {(onConfirmApproval || onDeclineApproval) && (
              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                {onDeclineApproval && (
                  <Btn size="sm" variant="danger" style={{ borderColor: COLORS.red, background: COLORS.redDim }} onClick={() => onDeclineApproval(job.id)}>
                    <X size={12} /> Not Approved
                  </Btn>
                )}
                {onConfirmApproval && (
                  <Btn size="sm" variant="teal" onClick={() => onConfirmApproval(job.id)}>
                    <CheckCircle2 size={12} /> Confirmed OK
                  </Btn>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {(job.approvalStage === "confirmed" || job.approvalStage === "acknowledged") && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 12px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 8 }}>
          <CheckCircle2 size={14} color={COLORS.teal} />
          <span style={{ fontSize: 12.5, color: COLORS.text }}>Customer confirmed — technician is clear to proceed.</span>
        </div>
      )}
      {(job.approvalStage === "declined" || job.approvalStage === "declined_acknowledged") && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 12px", background: COLORS.redDim, border: `1px solid ${COLORS.red}55`, borderRadius: 8 }}>
          <X size={14} color={COLORS.red} />
          <span style={{ fontSize: 12.5, color: COLORS.text }}>Customer did not approve the repair — service charge invoice generated, TV ready for return.</span>
        </div>
      )}
      {(onWhatsApp || onSms || onCall) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {onCall && (
            <Btn size="sm" variant="outline" onClick={() => onCall(job)}>
              <Phone size={13} /> Call Now
            </Btn>
          )}
          {onSms && (
            <Btn size="sm" variant="outline" onClick={() => onSms(job)}>
              <MessageSquare size={13} /> Send Update via SMS
            </Btn>
          )}
          {onWhatsApp && (
            <Btn size="sm" variant="teal" onClick={() => onWhatsApp(job)}>
              <MessageSquare size={13} /> Send Update via WhatsApp
            </Btn>
          )}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
        <div><span style={{ color: COLORS.faint }}>Customer:</span> {job.customer}</div>
        <div><span style={{ color: COLORS.faint }}>Phone:</span> {job.phone}</div>
        <div><span style={{ color: COLORS.faint }}>Device:</span> {job.brand} {job.model}</div>
        <div><span style={{ color: COLORS.faint }}>Technician:</span> {technicians.find((t) => t.id === job.assignedTech)?.name || "Unassigned"}</div>
        <div><span style={{ color: COLORS.faint }}>Location:</span> {job.location || "—"}</div>
        <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Issue:</span> {job.issue}</div>
        {job.fault && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: COLORS.faint }}>Section-wise Fault:</span>
            <FaultTags job={job} />
          </div>
        )}
        {job.partsUsed.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: COLORS.faint }}>Parts used:</span> {job.partsUsed.map((p) => `${p.partId} x${p.qty}${p.remark ? ` (${p.remark})` : ""}`).join(", ")}
          </div>
        )}
        {(job.faultPhoto || job.readyPhoto) && (
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 14, marginTop: 4 }}>
            {job.faultPhoto && (
              <div>
                <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Fault Photo</div>
                <img src={job.faultPhoto} alt="Fault" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
              </div>
            )}
            {job.readyPhoto && (
              <div>
                <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>TV Ready Photo</div>
                <img src={job.readyPhoto} alt="TV ready for delivery" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>Update Timeline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {job.updates.map((u, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.amber, marginTop: 5, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12.5 }}><strong>{u.by}</strong> — {u.note}</div>
              <div style={{ fontSize: 11, color: COLORS.faint }}>{fmtDateTime(u.ts)} · <Badge status={u.status} /></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
          Messages Sent to Customer
        </div>
        <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: COLORS.text, fontWeight: 700 }}>{jobMessages.length} total</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {["Call", "SMS", "WhatsApp"].map((ch) => (
          <span key={ch} style={{
            fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999,
            color: channelStyle[ch], background: `${channelStyle[ch]}22`,
          }}>
            {counts[ch] || 0} {ch}{counts[ch] === 1 ? "" : ch === "SMS" ? " msgs" : "s"}
          </span>
        ))}
      </div>
      {jobMessages.length === 0 ? (
        <div style={{ fontSize: 12, color: COLORS.faint }}>No messages sent to this customer yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
          {jobMessages.map((m, i) => {
            const ch = messageChannel(m.message);
            const text = m.message.replace(/^\[(WhatsApp|Call)\]\s*/, "");
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5,
                  color: channelStyle[ch], background: `${channelStyle[ch]}22`, flexShrink: 0, marginTop: 1,
                }}>
                  {ch}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.4 }}>{text}</div>
                  <div style={{ fontSize: 10.5, color: COLORS.faint, marginTop: 1 }}>{fmtDateTime(m.ts)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UpdateJobForm({ job, parts, onSave, onWhatsApp, technicians = [], jobs = [], onAssignTech, labelPrintEnforced = false }) {
  const [localAssignedTech, setLocalAssignedTech] = useState(job.assignedTech || null);
  const effectiveAssignedTech = job.assignedTech || localAssignedTech;
  const relevantTechs = job.jobType ? technicians.filter((t) => t.type === job.jobType) : technicians;
  const isSubStatusValue = OTHER_SUB_STATUS_OPTIONS.includes(job.status) && !MAIN_STATUS_OPTIONS.includes(job.status);
  const [mainStatus, setMainStatus] = useState(isSubStatusValue ? "others" : job.status);
  const [subStatus, setSubStatus] = useState(isSubStatusValue ? job.status : OTHER_SUB_STATUS_OPTIONS[0]);
  const status = mainStatus === "others" ? subStatus : mainStatus;
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customFeedback, setCustomFeedback] = useState("");
  const [location, setLocation] = useState(job.location || "");
  const [fault, setFault] = useState(job.fault || DEFAULT_FAULTS[0]);
  const [subFaults, setSubFaults] = useState(job.subFaults || []);
  const [readyPhoto, setReadyPhoto] = useState(job.readyPhoto || null);
  const [partRows, setPartRows] = useState([{ partId: "", qty: 1, remark: "" }]);
  const [openRemarkRows, setOpenRemarkRows] = useState(new Set());

  const addRow = () => setPartRows((r) => [...r, { partId: "", qty: 1, remark: "" }]);
  const removeRow = (i) => setPartRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i, field, val) => setPartRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  const validRows = partRows.filter((r) => r.partId && r.qty > 0);
  const isDelivering = DELIVERY_STATUSES.includes(status);
  const isInProgress = status === "in_repair";
  // Moving to a DIFFERENT status is "progressing" the job. Re-saving the
  // same status (e.g. just to attach a note) is never blocked — only
  // forward movement is, and only while the label is unprinted.
  const isProgressingStatus = status !== job.status;
  const blockedByUnprintedLabel = labelPrintEnforced && !job.isLabelPrinted && isProgressingStatus;
  const canSave = (!isDelivering || !!readyPhoto) && !blockedByUnprintedLabel;

  const buildNote = () => {
    if (isInProgress) {
      return [reason, customFeedback.trim()].filter(Boolean).join(" — ") || "Status updated to In Repair.";
    }
    return note || `Status updated to ${STATUS_META[status]?.label || status}.`;
  };

  return (
    <div>
      <Field label="Status">
        <Select value={mainStatus} onChange={(e) => setMainStatus(e.target.value)}>
          {MAIN_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </Field>
      {mainStatus === "others" && (
        <>
          <div style={{ height: 12 }} />
          <Field label="Others — Sub-Status">
            <Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
              {OTHER_SUB_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          </Field>
        </>
      )}
      <div style={{ height: 12 }} />

      {!effectiveAssignedTech && onAssignTech ? (
        <>
          <div style={{
            padding: "10px 12px", borderRadius: 8, background: COLORS.amberDim, border: `1px solid ${COLORS.amber}55`,
          }}>
            <Field label="Assign Technician — workload shown per technician">
              <Select
                value=""
                onChange={(e) => {
                  const techId = e.target.value;
                  if (!techId) return;
                  onAssignTech(job.id, techId);
                  setLocalAssignedTech(techId);
                }}
              >
                <option value="" disabled>Select technician…</option>
                {relevantTechs.map((t) => {
                  const activeCount = jobs.filter((j) => j.assignedTech === t.id && ACTIVE_JOB_STATUSES.includes(j.status)).length;
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.specialty} — {activeCount} active job{activeCount === 1 ? "" : "s"}
                    </option>
                  );
                })}
              </Select>
            </Field>
            {relevantTechs.length === 0 && (
              <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 6 }}>No technicians on file yet.</div>
            )}
          </div>
          <div style={{ height: 12 }} />
        </>
      ) : effectiveAssignedTech && !job.assignedTech ? (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8,
            background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, fontSize: 12.5, color: COLORS.text,
          }}>
            <CheckCircle2 size={14} color={COLORS.teal} /> Assigned to {technicians.find((t) => t.id === localAssignedTech)?.name || "technician"}.
          </div>
          <div style={{ height: 12 }} />
        </>
      ) : null}

      <Field label="Location">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. RS Puram, Coimbatore" />
      </Field>
      <div style={{ height: 12 }} />
      {isInProgress ? (
        <>
          <Field label="Reason (feedback to customer)">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {IN_PROGRESS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Additional Feedback (optional, appended to the reason above)">
            <TextArea value={customFeedback} onChange={(e) => setCustomFeedback(e.target.value)} placeholder="e.g. Ordered the T-Con board, expected in 2 days…" />
          </Field>
        </>
      ) : (
        <Field label="Progress Note (sent to customer via SMS) — tap the mic to speak">
          <VoiceInput value={note} onChange={setNote} placeholder="e.g. Diagnosed T-Con board fault, replacing now…" lang="en" multiline />
        </Field>
      )}
      <div style={{ height: 14 }} />
      <FaultSelector fault={fault} setFault={setFault} subFaults={subFaults} setSubFaults={setSubFaults} />
      <div style={{ height: 14 }} />
      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>Spare Parts Used</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {partRows.map((row, i) => {
          const remarkOpen = openRemarkRows.has(i) || !!row.remark;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Select value={row.partId} onChange={(e) => updateRow(i, "partId", e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                  <option value="">Select part…</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.qty} in stock)</option>)}
                </Select>
                <Input type="number" min={1} value={row.qty} onChange={(e) => updateRow(i, "qty", Number(e.target.value))} style={{ width: 70 }} />
                {!remarkOpen && (
                  <button
                    type="button"
                    onClick={() => setOpenRemarkRows((s) => new Set(s).add(i))}
                    style={{ background: "none", border: "none", color: COLORS.blue, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}
                  >
                    + Remarks
                  </button>
                )}
                <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
              {remarkOpen && (
                <Input
                  value={row.remark} onChange={(e) => updateRow(i, "remark", e.target.value)}
                  placeholder="Remarks for this part (optional) — e.g. reused from old unit, customer-supplied…"
                  style={{ fontSize: 12.5 }}
                />
              )}
            </div>
          );
        })}
      </div>
      <Btn variant="ghost" size="sm" onClick={addRow} style={{ marginTop: 8 }}><Plus size={13} /> Add part</Btn>

      {isDelivering && (
        <>
          <div style={{ height: 16 }} />
          <Panel style={{ padding: 14, border: `1px solid ${COLORS.teal}55`, background: `${COLORS.tealDim}33` }}>
            <PhotoUploadField label={`TV Ready Photo (required to mark ${STATUS_META[status].label})`} value={readyPhoto} onChange={setReadyPhoto} />
          </Panel>
        </>
      )}

      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn
          disabled={!canSave}
          onClick={() => onSave({ status, note: buildNote(), partsUsedDelta: validRows, fault, subFaults, readyPhoto, location })}
        >
          <CheckCircle2 size={14} /> Save &amp; SMS Update
        </Btn>
        {onWhatsApp && (
          <Btn
            variant="teal" disabled={!canSave}
            onClick={() => {
              onSave({ status, note: buildNote(), partsUsedDelta: validRows, fault, subFaults, readyPhoto, location });
              onWhatsApp({ ...job, status, fault, subFaults });
            }}
          >
            <MessageSquare size={14} /> Save &amp; WhatsApp Update
          </Btn>
        )}
      </div>
      {isDelivering && !readyPhoto && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: COLORS.amber }}>Add a "TV Ready" photo before marking this job {STATUS_META[status].label}.</div>
      )}
      {blockedByUnprintedLabel && (
        <div style={{
          marginTop: 8, display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", borderRadius: 8,
          background: COLORS.redDim, border: `1px solid ${COLORS.red}55`, fontSize: 11.5, color: COLORS.text,
        }}>
          <AlertTriangle size={14} color={COLORS.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This job's label hasn't been printed yet — print it from the job card before moving this job to {STATUS_META[status].label}.</span>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, color: COLORS.faint }}>
        Both buttons save the status, parts, and fault checklist and deduct used parts from inventory — "Save &amp; SMS Update" notifies the customer by SMS, "Save &amp; WhatsApp Update" also opens WhatsApp with the same update.
        The WhatsApp button lets you message the customer immediately without saving these changes yet.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  STANDBY TV — hand a customer a loaner TV (against an advance amount,   */
/*  for an agreed number of days) while their own set waits on spares.     */
/*  See giveStandbyTv() / the standby-TV reminder engine in the root       */
/*  component for the data + notification side of this feature.           */
/* ---------------------------------------------------------------------- */
function GiveStandbyTvForm({ job, onSave }) {
  const [tvGiven, setTvGiven] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [days, setDays] = useState(3);
  const valid = tvGiven.trim().length > 0 && Number(days) > 0;

  return (
    <div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 14, lineHeight: 1.5 }}>
        For <strong style={{ fontFamily: FONT_MONO }}>{job.id}</strong> — {job.customer}, currently {STATUS_META[job.status]?.label || job.status}.
      </div>
      <Field label="Standby TV Given (brand/model or asset tag)">
        <Input value={tvGiven} onChange={(e) => setTvGiven(e.target.value)} placeholder={'e.g. Samsung 32" LED — Standby Unit #4'} />
      </Field>
      <div style={{ height: 12 }} />
      <Field label="Advance Amount Collected (₹)">
        <Input type="number" min={0} value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} placeholder="e.g. 1500" />
      </Field>
      <div style={{ height: 12 }} />
      <Field label="Days Customer Needs the Standby TV">
        <Input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
      </Field>
      <div style={{ marginTop: 10, fontSize: 11.5, color: COLORS.faint, lineHeight: 1.5 }}>
        Admin/Front Desk will get a reminder to collect the standby TV back once {days || 1} day{Number(days) === 1 ? "" : "s"} {Number(days) === 1 ? "has" : "have"} passed.
      </div>
      <div style={{ marginTop: 16 }}>
        <Btn disabled={!valid} onClick={() => onSave({ tvGiven, advanceAmount, days })}>
          <Tv size={14} /> Record Standby TV
        </Btn>
      </div>
    </div>
  );
}

/* Small inline status pill shown on a job row once a standby loan exists —
   used by Dashboard / FrontDeskDashboard / JobCardsList so it's obvious at
   a glance without opening the job. */
function StandbyLoanBadge({ loan, tick, onMarkReturned }) {
  if (!loan) return null;
  if (loan.returned) {
    return (
      <span style={{ fontSize: 10.5, color: COLORS.teal, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 3 }}>
        <CheckCircle2 size={11} /> standby returned
      </span>
    );
  }
  const overdue = Date.now() >= loan.dueAt;
  const daysLeft = Math.max(0, Math.ceil((loan.dueAt - Date.now()) / (24 * H)));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 10.5, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 3,
        color: overdue ? COLORS.red : COLORS.blue,
      }}>
        <Tv size={11} /> standby {overdue ? "overdue" : `${daysLeft}d left`}
      </span>
      {onMarkReturned && (
        <button
          type="button" onClick={() => onMarkReturned(loan.id)}
          style={{ background: "none", border: "none", color: COLORS.teal, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0, textDecoration: "underline" }}
        >
          Mark Returned
        </button>
      )}
    </span>
  );
}

/* Admin/Front Desk list view of every standby-TV loan — active and past —
   reachable from the sidebar so this is easy to check on its own, not
   just from the reminder popup or a single job's row. */
function StandbyTvView({ loans, jobs, tick, onMarkReturned }) {
  const [filter, setFilter] = useState("active"); // active | returned | all
  const filtered = loans.filter((l) => {
    if (filter === "active") return !l.returned;
    if (filter === "returned") return l.returned;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => b.givenAt - a.givenAt);

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>Standby TVs</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 16, lineHeight: 1.5 }}>
        Every loaner TV handed out while a job waits on spares — advance collected, days agreed, and when it's due back.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["active", "returned", "all"].map((f) => (
          <Btn key={f} size="sm" variant={filter === f ? "teal" : "outline"} onClick={() => setFilter(f)}>
            {f === "active" ? "Active" : f === "returned" ? "Returned" : "All"}
          </Btn>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No standby TV loans{filter !== "all" ? ` (${filter})` : ""} yet.</div>}
        {sorted.map((l) => {
          const job = jobs.find((j) => j.id === l.jobId);
          const overdue = !l.returned && Date.now() >= l.dueAt;
          return (
            <Panel key={l.id} style={{ padding: 13, borderColor: overdue ? `${COLORS.red}66` : COLORS.border }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{l.jobId}</span>
                    <span style={{ fontSize: 12.5 }}>{l.customer}</span>
                    <StandbyLoanBadge loan={l} tick={tick} />
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.muted }}>{l.tvGiven || "Standby unit"} {job ? `— for ${job.brand} ${job.model}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 3 }}>
                    Advance {fmtMoney(l.advanceAmount)} · {l.days} day{l.days === 1 ? "" : "s"} · given {fmtDateTime(l.givenAt)} · due {fmtDateTime(l.dueAt)}
                    {l.returned && l.returnedAt ? ` · returned ${fmtDateTime(l.returnedAt)}` : ""}
                  </div>
                </div>
                {!l.returned && (
                  <Btn size="sm" onClick={() => onMarkReturned(l.id)}><CheckCircle2 size={13} /> Mark Returned</Btn>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  BILLING (Admin)                                                         */
/* ---------------------------------------------------------------------- */
function Billing({ jobs, invoices, parts, role, onCreateInvoice, onMarkPaid, onPrint, revenueToday, outstandingDues }) {
  const invoiceable = jobs.filter((j) => INVOICEABLE_STATUSES.includes(j.status) && !j.invoiced);
  const [billingJob, setBillingJob] = useState(null);
  const [showTodayInvoices, setShowTodayInvoices] = useState(false);
  const [showTodayRevenue, setShowTodayRevenue] = useState(false);
  const [showTotalRevenue, setShowTotalRevenue] = useState(false);
  const [totalRevFrom, setTotalRevFrom] = useState("");
  const [totalRevTo, setTotalRevTo] = useState("");
  const revenueClickTimes = useRef([]);
  const isAdmin = role === "admin";

  // Tap "Revenue Today" 5x in quick succession (within ~1.2s between taps)
  // to open the hidden "Total Revenue" view with a custom date range —
  // a quick shortcut for admins who want a number outside "today".
  function handleRevenueTap() {
    const now = Date.now();
    revenueClickTimes.current = [...revenueClickTimes.current.filter((t) => now - t < 1200), now];
    if (revenueClickTimes.current.length >= 5) {
      revenueClickTimes.current = [];
      setShowTotalRevenue(true);
    } else {
      setShowTodayRevenue(true);
    }
  }

  const todayInvoices = invoices.filter((inv) => isSameDay(inv.createdAt));
  const todayPaidInvoices = invoices.filter((inv) => inv.paymentStatus === "Paid" && isSameDay(inv.paidAt));

  const totalRevRangeInvoices = invoices.filter((inv) => {
    if (inv.paymentStatus !== "Paid" || !inv.paidAt) return false;
    const d = new Date(inv.paidAt);
    if (totalRevFrom && d < new Date(totalRevFrom + "T00:00:00")) return false;
    if (totalRevTo && d > new Date(totalRevTo + "T23:59:59")) return false;
    return true;
  });
  const totalRevInRange = totalRevRangeInvoices.reduce((sum, inv) => sum + inv.total, 0);

  // ---- date filter for "All Invoices" (also drives the revenue summary below) ----
  const [filterMode, setFilterMode] = useState("all"); // all | day | month | custom
  const [filterDay, setFilterDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const filteredInvoices = invoices.filter((inv) => {
    if (filterMode === "all") return true;
    const d = new Date(inv.createdAt);
    if (filterMode === "day") {
      return d.toISOString().slice(0, 10) === filterDay;
    }
    if (filterMode === "month") {
      return d.toISOString().slice(0, 7) === filterMonth;
    }
    if (filterMode === "custom") {
      if (filterFrom && d < new Date(filterFrom + "T00:00:00")) return false;
      if (filterTo && d > new Date(filterTo + "T23:59:59")) return false;
      return true;
    }
    return true;
  });
  const filteredRevenue = filteredInvoices
    .filter((inv) => inv.paymentStatus === "Paid")
    .reduce((sum, inv) => sum + inv.total, 0);
  const filterRangeLabel = filterMode === "all" ? "all time"
    : filterMode === "day" ? fmtDate(new Date(filterDay + "T00:00:00").getTime())
    : filterMode === "month" ? new Date(filterMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "selected range";

  return (
    <div>
      <div className="stat-row" style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        {isAdmin && (
          <StatCard
            icon={IndianRupee} label="Revenue Today" value={fmtMoney(revenueToday)} sub="Today · tap to view"
            accent={COLORS.teal} onClick={handleRevenueTap}
          />
        )}
        <StatCard icon={AlertTriangle} label="Outstanding Dues" value={fmtMoney(outstandingDues)} accent={COLORS.red} />
        <StatCard
          icon={Receipt} label="Invoices Issued" value={todayInvoices.length} sub="Today · tap to view"
          accent={COLORS.amber} onClick={() => setShowTodayInvoices(true)}
        />
      </div>

      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Ready to Invoice</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 26 }}>
        {invoiceable.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No completed jobs awaiting billing.</div>}
        {invoiceable.map((j) => (
          <Panel key={j.id} style={{ padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{j.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {j.customer}</span></div>
              <div style={{ fontSize: 12, color: COLORS.muted }}>{j.brand} {j.model} · {j.partsUsed.length} part(s) used</div>
            </div>
            <Btn size="sm" onClick={() => setBillingJob(j)}><Receipt size={13} /> Generate Invoice</Btn>
          </Panel>
        ))}
      </div>

      {isAdmin && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>All Invoices</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Select value={filterMode} onChange={(e) => setFilterMode(e.target.value)} style={{ width: 150 }}>
                <option value="all">All time</option>
                <option value="day">Per day</option>
                <option value="month">Per month</option>
                <option value="custom">Custom range</option>
              </Select>
              {filterMode === "day" && (
                <Input type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} style={{ width: 150 }} />
              )}
              {filterMode === "month" && (
                <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ width: 150 }} />
              )}
              {filterMode === "custom" && (
                <>
                  <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} placeholder="From" style={{ width: 145 }} />
                  <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} placeholder="To" style={{ width: 145 }} />
                </>
              )}
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "9px 12px",
            background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 8,
          }}>
            <IndianRupee size={14} color={COLORS.teal} />
            <span style={{ fontSize: 12.5, color: COLORS.text }}>
              Revenue for {filterRangeLabel}: <strong style={{ fontFamily: FONT_MONO }}>{fmtMoney(filteredRevenue)}</strong>
              <span style={{ color: COLORS.faint }}> ({filteredInvoices.length} invoice{filteredInvoices.length === 1 ? "" : "s"})</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredInvoices.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No invoices in this range.</div>}
            {filteredInvoices.map((inv) => {
              const PayIcon = PAY_ICON[inv.paymentMethod] || Banknote;
              return (
                <Panel key={inv.id} style={{ padding: 13, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{inv.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {inv.customer}</span></div>
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>{inv.jobId} · {fmtDate(inv.createdAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.muted, width: 110 }}>
                    <PayIcon size={13} /> {inv.paymentMethod}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5, width: 90 }}>{fmtMoney(inv.total)}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    color: inv.paymentStatus === "Paid" ? COLORS.teal : COLORS.amber,
                    background: inv.paymentStatus === "Paid" ? COLORS.tealDim : COLORS.amberDim,
                  }}>{inv.paymentStatus}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {inv.paymentStatus === "Pending" && <Btn size="sm" variant="teal" onClick={() => onMarkPaid(inv.id)}>Mark Paid</Btn>}
                    <Btn size="sm" variant="outline" onClick={() => onPrint(inv)}><Printer size={13} /> Print</Btn>
                  </div>
                </Panel>
              );
            })}
          </div>
        </>
      )}

      {billingJob && (
        <Modal title={`Generate Invoice — ${billingJob.id}`} onClose={() => setBillingJob(null)}>
          <InvoiceForm
            job={billingJob} parts={parts}
            onSubmit={(labor, method, status) => { onCreateInvoice(billingJob, labor, method, status); setBillingJob(null); }}
          />
        </Modal>
      )}

      {showTodayInvoices && (
        <Modal title={`Today's Invoices (${todayInvoices.length})`} onClose={() => setShowTodayInvoices(false)} width={560}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {todayInvoices.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No invoices issued yet today.</div>}
            {todayInvoices.map((inv) => {
              const PayIcon = PAY_ICON[inv.paymentMethod] || Banknote;
              return (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.border}`, flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{inv.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {inv.customer}</span></div>
                    <div style={{ fontSize: 11, color: COLORS.faint }}>{inv.jobId} · {fmtDateTime(inv.createdAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.muted }}>
                    <PayIcon size={13} /> {inv.paymentMethod}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{fmtMoney(inv.total)}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    color: inv.paymentStatus === "Paid" ? COLORS.teal : COLORS.amber,
                    background: inv.paymentStatus === "Paid" ? COLORS.tealDim : COLORS.amberDim,
                  }}>{inv.paymentStatus}</span>
                  <Btn size="sm" variant="outline" onClick={() => onPrint(inv)}><Printer size={13} /></Btn>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {showTodayRevenue && (
        <Modal title={`Today's Revenue — ${fmtMoney(revenueToday)}`} onClose={() => setShowTodayRevenue(false)} width={560}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {todayPaidInvoices.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No payments received yet today.</div>}
            {todayPaidInvoices.map((inv) => {
              const PayIcon = PAY_ICON[inv.paymentMethod] || Banknote;
              return (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.teal}55`, flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{inv.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {inv.customer}</span></div>
                    <div style={{ fontSize: 11, color: COLORS.faint }}>{inv.jobId} · paid {fmtDateTime(inv.paidAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.muted }}>
                    <PayIcon size={13} /> {inv.paymentMethod}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5, color: COLORS.teal }}>{fmtMoney(inv.total)}</div>
                  <Btn size="sm" variant="outline" onClick={() => onPrint(inv)}><Printer size={13} /></Btn>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {showTotalRevenue && (
        <Modal title="Total Revenue — Custom Dates" onClose={() => setShowTotalRevenue(false)} width={560}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <Field label="From">
              <Input type="date" value={totalRevFrom} onChange={(e) => setTotalRevFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={totalRevTo} onChange={(e) => setTotalRevTo(e.target.value)} />
            </Field>
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "14px 16px",
            background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 10,
          }}>
            <IndianRupee size={22} color={COLORS.teal} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: FONT_MONO, color: COLORS.text }}>{fmtMoney(totalRevInRange)}</div>
              <div style={{ fontSize: 11.5, color: COLORS.faint }}>
                {totalRevFrom || totalRevTo
                  ? `${totalRevFrom ? fmtDate(new Date(totalRevFrom + "T00:00:00").getTime()) : "the beginning"} → ${totalRevTo ? fmtDate(new Date(totalRevTo + "T00:00:00").getTime()) : "today"}`
                  : "All time (no dates selected)"}
                {" "}· {totalRevRangeInvoices.length} paid invoice{totalRevRangeInvoices.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
            Contributing Payments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
            {totalRevRangeInvoices.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>No paid invoices in this range.</div>}
            {totalRevRangeInvoices.map((inv) => {
              const PayIcon = PAY_ICON[inv.paymentMethod] || Banknote;
              return (
                <div key={inv.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.border}`, flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12 }}>{inv.id} <span style={{ color: COLORS.faint, fontWeight: 400, fontFamily: FONT_SANS }}>— {inv.customer}</span></div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint }}>{inv.jobId} · paid {fmtDate(inv.paidAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: COLORS.muted }}>
                    <PayIcon size={12} /> {inv.paymentMethod}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5, color: COLORS.teal }}>{fmtMoney(inv.total)}</div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function InvoiceForm({ job, parts, onSubmit }) {
  const [labor, setLabor] = useState(String(job.estimate || 500));
  const [method, setMethod] = useState("Cash");
  const [status, setStatus] = useState("Paid");
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));
  const partsTotal = job.partsUsed.reduce((s, pu) => s + (partMap[pu.partId]?.cost || 0) * pu.qty, 0);
  const total = partsTotal + (Number(labor) || 0);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        {job.partsUsed.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, color: COLORS.faint, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Parts Used</div>
            {job.partsUsed.map((pu, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                <span>{partMap[pu.partId]?.name} x{pu.qty}{pu.remark ? <span style={{ color: COLORS.faint }}> ({pu.remark})</span> : null}</span>
                <span style={{ fontFamily: FONT_MONO }}>{fmtMoney((partMap[pu.partId]?.cost || 0) * pu.qty)}</span>
              </div>
            ))}
          </div>
        )}
        <Field label="Service & Labor Charge (₹)"><Input type="number" value={labor} onChange={(e) => setLabor(e.target.value)} /></Field>
      </div>

      <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Field label="Payment Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>Cash</option><option>GPay</option><option>Credit Card</option>
          </Select>
        </Field>
        <Field label="Payment Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>Paid</option><option>Pending</option>
          </Select>
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: `1px solid ${COLORS.border}`, fontSize: 15, fontWeight: 800 }}>
        <span>Total</span><span style={{ fontFamily: FONT_MONO, color: COLORS.amber }}>{fmtMoney(total)}</span>
      </div>

      <Btn style={{ width: "100%", marginTop: 8 }} onClick={() => onSubmit(labor, method, status)}>
        <Receipt size={14} /> Generate Invoice
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  INVENTORY (Admin)                                                       */
/* ---------------------------------------------------------------------- */
function Inventory({ parts, setParts }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", qty: "", cost: "", low: "" });

  function addPart() {
    if (!f.name.trim()) return;
    setParts((p) => [...p, { id: "P" + (Math.max(0, ...p.map((x) => Number(x.id.slice(1)))) + 1), name: f.name, qty: Number(f.qty) || 0, cost: Number(f.cost) || 0, low: Number(f.low) || 3 }]);
    setF({ name: "", qty: "", cost: "", low: "" });
    setAdding(false);
  }

  function adjustQty(id, delta) {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, qty: Math.max(0, p.qty + delta) } : p)));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Spare Parts Inventory</div>
        <Btn size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add Part</Btn>
      </div>

      {adding && (
        <Panel style={{ padding: 16, marginBottom: 16 }}>
          <div className="form-grid-4col" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
            <Field label="Part Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Qty"><Input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            <Field label="Unit Cost (₹)"><Input type="number" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
            <Field label="Low-stock at"><Input type="number" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Btn size="sm" onClick={addPart}>Save</Btn>
            <Btn size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </Panel>
      )}

      <Panel className="table-scroll" style={{ overflow: "hidden" }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.8fr 1fr 1fr", padding: "10px 15px", background: COLORS.panel2, fontSize: 11, color: COLORS.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span>Part</span><span>Stock</span><span>Unit Cost</span><span>Status</span><span>Adjust</span>
          </div>
          {parts.map((p) => (
            <div key={p.id} className="rowhover" style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.8fr 1fr 1fr", padding: "11px 15px", borderTop: `1px solid ${COLORS.border}`, alignItems: "center", fontSize: 13 }}>
              <span>{p.name}</span>
              <span style={{ fontFamily: FONT_MONO }}>{p.qty}</span>
              <span style={{ fontFamily: FONT_MONO }}>{fmtMoney(p.cost)}</span>
              <span>
                {p.qty <= p.low
                  ? <span style={{ color: COLORS.red, fontSize: 11.5, fontWeight: 700, background: COLORS.redDim, padding: "2px 8px", borderRadius: 999 }}>Low stock</span>
                  : <span style={{ color: COLORS.teal, fontSize: 11.5, fontWeight: 700, background: COLORS.tealDim, padding: "2px 8px", borderRadius: 999 }}>In stock</span>}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button onClick={() => adjustQty(p.id, -1)} style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 6, cursor: "pointer", padding: 4 }}><PackageMinus size={13} color={COLORS.muted} /></button>
                <button onClick={() => adjustQty(p.id, 1)} style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 6, cursor: "pointer", padding: 4 }}><PackagePlus size={13} color={COLORS.muted} /></button>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  TECHNICIANS (Admin)                                                     */
/* ---------------------------------------------------------------------- */
function TechniciansView({ technicians, setTechnicians, jobs, role, onRequestDelete, extraTasks = [], onAssignExtraWork, onCompleteExtraWork, onDeleteExtraWork }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", specialty: "", type: "indoor" });
  const [assigningTo, setAssigningTo] = useState(null); // technician id currently getting extra work assigned
  const [taskForm, setTaskForm] = useState({ title: "", notes: "", priority: "normal", dueAt: "" });
  const canManageRoster = role === "admin";

  function addTech() {
    if (!f.name.trim()) return;
    setTechnicians((t) => [...t, { id: "T" + (t.length + 1) + Math.floor(Math.random() * 90), ...f }]);
    setF({ name: "", phone: "", specialty: "", type: "indoor" });
    setAdding(false);
  }

  function submitExtraWork(techId) {
    if (!taskForm.title.trim() || !onAssignExtraWork) return;
    onAssignExtraWork(techId, taskForm, roleLabel[role] || "Office");
    setTaskForm({ title: "", notes: "", priority: "normal", dueAt: "" });
    setAssigningTo(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Technicians</div>
        {canManageRoster && <Btn size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add Technician</Btn>}
      </div>

      {adding && canManageRoster && (
        <Panel style={{ padding: 16, marginBottom: 16 }}>
          <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Specialty"><Input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></Field>
            <Field label="Login Type">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="indoor">Indoor Technician</option>
                <option value="outdoor">Outdoor Technician</option>
              </Select>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Btn size="sm" onClick={addTech}>Save</Btn>
            <Btn size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: 12 }}>
        {technicians.map((t) => {
          const active = jobs.filter((j) => j.assignedTech === t.id && j.status !== "delivered").length;
          const done = jobs.filter((j) => j.assignedTech === t.id && ["ready_for_delivery", "delivered", "returned_unrepaired", "closed"].includes(j.status)).length;
          const pendingTasks = extraTasks.filter((task) => task.techId === t.id && task.status === "pending");
          return (
            <Panel key={t.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700 }}>
                    {t.name.split(" ").map((x) => x[0]).join("")}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                      {t.name}
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: t.type === "outdoor" ? COLORS.blue : COLORS.amber, background: t.type === "outdoor" ? `${COLORS.blue}22` : COLORS.amberDim, padding: "2px 6px", borderRadius: 999 }}>
                        {t.type === "outdoor" ? "Outdoor" : "Indoor"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>{t.specialty}</div>
                  </div>
                </div>
                {canManageRoster && (
                  <button
                    onClick={() => onRequestDelete(t)}
                    title="Remove technician"
                    style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", padding: 2, flexShrink: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.muted, display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}><Phone size={11} /> {t.phone}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, background: COLORS.amberDim, color: COLORS.amber, padding: "3px 9px", borderRadius: 999, fontWeight: 700 }}>{active} active</span>
                <span style={{ fontSize: 11, background: COLORS.tealDim, color: COLORS.teal, padding: "3px 9px", borderRadius: 999, fontWeight: 700 }}>{done} delivered</span>
                {pendingTasks.length > 0 && (
                  <span style={{ fontSize: 11, background: `${COLORS.blue}22`, color: COLORS.blue, padding: "3px 9px", borderRadius: 999, fontWeight: 700 }}>{pendingTasks.length} extra task{pendingTasks.length > 1 ? "s" : ""}</span>
                )}
              </div>

              {pendingTasks.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {pendingTasks.map((task) => (
                    <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 7, background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, display: "flex", alignItems: "center", gap: 6 }}>
                          {task.priority === "urgent" && <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.red, background: COLORS.redDim, padding: "1px 6px", borderRadius: 999 }}>URGENT</span>}
                          {task.title}
                        </div>
                        {task.notes && <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 2 }}>{task.notes}</div>}
                        <div style={{ fontSize: 10.5, color: COLORS.faint, marginTop: 3 }}>
                          Assigned by {task.assignedBy}{task.dueAt ? ` · Due ${fmtDateTime(task.dueAt)}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => onCompleteExtraWork && onCompleteExtraWork(task.id)} title="Mark done" style={{ background: "none", border: "none", color: COLORS.teal, cursor: "pointer", padding: 3 }}>
                          <CheckCircle2 size={15} />
                        </button>
                        <button onClick={() => onDeleteExtraWork && onDeleteExtraWork(task.id)} title="Remove task" style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", padding: 3 }}>
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {assigningTo === t.id ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
                  <Field label="Task"><Input placeholder="e.g. Restock parts bin" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} /></Field>
                  <div style={{ marginTop: 8 }}>
                    <Field label="Notes (optional)"><TextArea rows={2} value={taskForm.notes} onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })} /></Field>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Field label="Priority">
                        <Select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                          <option value="normal">Normal</option>
                          <option value="urgent">Urgent</option>
                        </Select>
                      </Field>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Field label="Due (optional)"><Input type="datetime-local" value={taskForm.dueAt} onChange={(e) => setTaskForm({ ...taskForm, dueAt: e.target.value ? new Date(e.target.value).getTime() : "" })} /></Field>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn size="sm" onClick={() => submitExtraWork(t.id)}>Assign</Btn>
                    <Btn size="sm" variant="outline" onClick={() => { setAssigningTo(null); setTaskForm({ title: "", notes: "", priority: "normal", dueAt: "" }); }}>Cancel</Btn>
                  </div>
                </div>
              ) : (
                <Btn size="sm" variant="outline" onClick={() => setAssigningTo(t.id)} style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
                  <ClipboardList size={13} /> Assign Extra Work
                </Btn>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  WORK REPORTS (Admin / Front Desk) — per-technician job/revenue/extra-  */
/*  work summary over This Week, This Month, or a custom date range, with */
/*  an Indoor/Outdoor filter and a CSV export. "Completed" counts a job    */
/*  toward whichever technician it's CURRENTLY assigned to (reassignment  */
/*  mid-repair is rare, and this keeps the numbers simple to explain).     */
/* ---------------------------------------------------------------------- */
function ReportsView({ technicians, jobs, invoices, extraTasks = [] }) {
  const [rangeMode, setRangeMode] = useState("week"); // "week" | "month" | "custom"
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | "indoor" | "outdoor"
  const [dailyTechId, setDailyTechId] = useState(null); // technician currently drilled into for the daily breakdown
  useBackClose("reports-dailyTech", !!dailyTechId, () => setDailyTechId(null));
  const [jobDetailTechId, setJobDetailTechId] = useState(null); // technician currently drilled into for the per-job detail list
  useBackClose("reports-jobDetailTech", !!jobDetailTechId, () => setJobDetailTechId(null));

  const range = useMemo(() => {
    const today = new Date();
    if (rangeMode === "week") return { start: startOfWeek(today), end: endOfWeek(today) };
    if (rangeMode === "month") return { start: startOfMonth(today), end: endOfMonth(today) };
    return {
      start: customFrom ? new Date(customFrom + "T00:00:00") : new Date(0),
      end: customTo ? new Date(customTo + "T23:59:59") : today,
    };
  }, [rangeMode, customFrom, customTo]);

  const inRange = (ts) => ts && ts >= range.start.getTime() && ts <= range.end.getTime();
  const COMPLETED_STATUSES = ["ready_for_delivery", "delivered", "returned_unrepaired", "closed"];

  const visibleTechs = technicians.filter((t) => typeFilter === "all" || t.type === typeFilter);

  const rows = visibleTechs.map((t) => {
    const techJobs = jobs.filter((j) => j.assignedTech === t.id);
    const newJobs = techJobs.filter((j) => inRange(j.intake));
    const completedJobs = techJobs.filter((j) => COMPLETED_STATUSES.includes(j.status) && inRange(j.updates[j.updates.length - 1]?.ts));
    const revenue = invoices
      .filter((inv) => inv.paymentStatus === "Paid" && inRange(inv.paidAt) && techJobs.some((j) => j.id === inv.jobId))
      .reduce((sum, inv) => sum + inv.total, 0);
    const extraDone = extraTasks.filter((task) => task.techId === t.id && task.status === "done" && inRange(task.completedAt));
    return {
      tech: t, newJobs: newJobs.length, completedJobs: completedJobs.length,
      revenue, extraTasksDone: extraDone.length,
    };
  });

  const totals = rows.reduce((acc, r) => ({
    newJobs: acc.newJobs + r.newJobs, completedJobs: acc.completedJobs + r.completedJobs,
    revenue: acc.revenue + r.revenue, extraTasksDone: acc.extraTasksDone + r.extraTasksDone,
  }), { newJobs: 0, completedJobs: 0, revenue: 0, extraTasksDone: 0 });

  const rangeLabel = `${fmtDate(range.start.getTime())} → ${fmtDate(range.end.getTime())}`;

  function exportCsv() {
    const header = ["Technician", "Type", "Specialty", "New Jobs", "Completed Jobs", "Revenue Collected", "Extra Tasks Completed", "Range"];
    const dataRows = rows.map((r) => [
      r.tech.name, r.tech.type === "outdoor" ? "Outdoor" : "Indoor", r.tech.specialty || "",
      r.newJobs, r.completedJobs, r.revenue, r.extraTasksDone, rangeLabel,
    ]);
    const totalsRow = ["TOTAL", "", "", totals.newJobs, totals.completedJobs, totals.revenue, totals.extraTasksDone, rangeLabel];
    downloadCsv(`technician-work-report_${rangeMode}_${todayYYYYMMDD()}.csv`, [header, ...dataRows, totalsRow]);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Technician Work Reports</div>
        <Btn size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={13} /> Export CSV
        </Btn>
      </div>

      <Panel style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Btn size="sm" variant={rangeMode === "week" ? "teal" : "outline"} onClick={() => setRangeMode("week")}>This Week</Btn>
          <Btn size="sm" variant={rangeMode === "month" ? "teal" : "outline"} onClick={() => setRangeMode("month")}>This Month</Btn>
          <Btn size="sm" variant={rangeMode === "custom" ? "teal" : "outline"} onClick={() => setRangeMode("custom")}>Custom Range</Btn>
        </div>

        {rangeMode === "custom" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ minWidth: 160 }}>
              <Field label="From"><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></Field>
            </div>
            <div style={{ minWidth: 160 }}>
              <Field label="To"><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></Field>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: COLORS.faint, fontWeight: 700 }}>TYPE:</span>
          <Btn size="sm" variant={typeFilter === "all" ? "teal" : "outline"} onClick={() => setTypeFilter("all")}>All</Btn>
          <Btn size="sm" variant={typeFilter === "indoor" ? "teal" : "outline"} onClick={() => setTypeFilter("indoor")}>Indoor</Btn>
          <Btn size="sm" variant={typeFilter === "outdoor" ? "teal" : "outline"} onClick={() => setTypeFilter("outdoor")}>Outdoor</Btn>
        </div>

        <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 12 }}>
          Showing <strong style={{ color: COLORS.text }}>{rangeLabel}</strong> · {visibleTechs.length} technician{visibleTechs.length === 1 ? "" : "s"}
        </div>
      </Panel>

      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard icon={ClipboardList} label="New Jobs" value={totals.newJobs} sub={rangeLabel} accent={COLORS.amber} />
        <StatCard icon={CheckCircle2} label="Completed Jobs" value={totals.completedJobs} sub={rangeLabel} accent={COLORS.teal} />
        <StatCard icon={IndianRupee} label="Revenue Collected" value={fmtMoney(totals.revenue)} sub={rangeLabel} accent={COLORS.blue} />
        <StatCard icon={Wrench} label="Extra Tasks Done" value={totals.extraTasksDone} sub={rangeLabel} accent={COLORS.red} />
      </div>

      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: COLORS.panel2, textAlign: "left" }}>
                {["Technician", "Type", "New Jobs", "Completed", "Revenue", "Extra Tasks", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 700, fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: COLORS.faint }}>No technicians match this filter.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.tech.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: "10px 14px", fontWeight: 700 }}>{r.tech.name}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: r.tech.type === "outdoor" ? COLORS.blue : COLORS.amber, background: r.tech.type === "outdoor" ? `${COLORS.blue}22` : COLORS.amberDim, padding: "2px 7px", borderRadius: 999 }}>
                      {r.tech.type === "outdoor" ? "Outdoor" : "Indoor"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO }}>{r.newJobs}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO }}>{r.completedJobs}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO }}>{fmtMoney(r.revenue)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO }}>{r.extraTasksDone}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Btn size="sm" variant="outline" onClick={() => setDailyTechId(r.tech.id)}>
                        <Calendar size={12} /> Daily
                      </Btn>
                      <Btn size="sm" variant="outline" onClick={() => setJobDetailTechId(r.tech.id)}>
                        <ClipboardList size={12} /> Job Details
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: COLORS.panel2 }}>
                  <td style={{ padding: "10px 14px", fontWeight: 700 }} colSpan={2}>Total</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, fontWeight: 700 }}>{totals.newJobs}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, fontWeight: 700 }}>{totals.completedJobs}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, fontWeight: 700 }}>{fmtMoney(totals.revenue)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: FONT_MONO, fontWeight: 700 }}>{totals.extraTasksDone}</td>
                  <td style={{ padding: "10px 14px" }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Panel>

      {dailyTechId && (
        <TechnicianDailyReportModal
          tech={technicians.find((t) => t.id === dailyTechId)}
          jobs={jobs} invoices={invoices} extraTasks={extraTasks}
          onClose={() => setDailyTechId(null)}
        />
      )}

      {jobDetailTechId && (
        <TechnicianJobDetailReportModal
          tech={technicians.find((t) => t.id === jobDetailTechId)}
          jobs={jobs} invoices={invoices}
          onClose={() => setJobDetailTechId(null)}
        />
      )}
    </div>
  );
}

/* Drill-down modal: a single technician's day-by-day breakdown over any
   custom date range (defaults to the last 7 days). Each row is one
   calendar day so Admin/Front Desk can see exactly which days were busy,
   not just a period total. */
function TechnicianDailyReportModal({ tech, jobs, invoices, extraTasks = [], onClose }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 6 * 24 * H).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo] = useState(todayStr);

  const COMPLETED_STATUSES = ["ready_for_delivery", "delivered", "returned_unrepaired", "closed"];
  const techJobs = jobs.filter((j) => j.assignedTech === tech?.id);

  const days = useMemo(() => {
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    const list = [];
    if (!tech || start > end) return list;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      const inDay = (ts) => ts && ts >= dayStart.getTime() && ts <= dayEnd.getTime();
      const newJobs = techJobs.filter((j) => inDay(j.intake));
      const completedJobs = techJobs.filter((j) => COMPLETED_STATUSES.includes(j.status) && inDay(j.updates[j.updates.length - 1]?.ts));
      const revenue = invoices
        .filter((inv) => inv.paymentStatus === "Paid" && inDay(inv.paidAt) && techJobs.some((j) => j.id === inv.jobId))
        .reduce((sum, inv) => sum + inv.total, 0);
      const extraDone = extraTasks.filter((task) => task.techId === tech.id && task.status === "done" && inDay(task.completedAt));
      list.push({
        date: new Date(dayStart), newJobs: newJobs.length, completedJobs: completedJobs.length,
        revenue, extraTasksDone: extraDone.length,
      });
    }
    return list;
  }, [from, to, tech, techJobs, invoices, extraTasks]);

  const dayTotals = days.reduce((acc, d) => ({
    newJobs: acc.newJobs + d.newJobs, completedJobs: acc.completedJobs + d.completedJobs,
    revenue: acc.revenue + d.revenue, extraTasksDone: acc.extraTasksDone + d.extraTasksDone,
  }), { newJobs: 0, completedJobs: 0, revenue: 0, extraTasksDone: 0 });

  function exportDailyCsv() {
    const header = ["Date", "New Jobs", "Completed Jobs", "Revenue Collected", "Extra Tasks Completed"];
    const dataRows = days.map((d) => [fmtDate(d.date.getTime()), d.newJobs, d.completedJobs, d.revenue, d.extraTasksDone]);
    const totalsRow = ["TOTAL", dayTotals.newJobs, dayTotals.completedJobs, dayTotals.revenue, dayTotals.extraTasksDone];
    downloadCsv(`${(tech?.name || "technician").replace(/\s+/g, "-").toLowerCase()}-daily-report_${from}_to_${to}.csv`, [header, ...dataRows, totalsRow]);
  }

  if (!tech) return null;

  return (
    <Modal title={`Daily Report — ${tech.name}`} onClose={onClose} width={640}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div style={{ minWidth: 150 }}>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} /></Field>
        </div>
        <div style={{ minWidth: 150 }}>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} max={todayStr} /></Field>
        </div>
        <Btn size="sm" onClick={exportDailyCsv} disabled={days.length === 0}>
          <Download size={13} /> Export CSV
        </Btn>
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.faint, marginBottom: 10 }}>
        {tech.type === "outdoor" ? "Outdoor" : "Indoor"} Technician · {tech.specialty} · {days.length} day{days.length === 1 ? "" : "s"}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: COLORS.panel2, textAlign: "left" }}>
              {["Date", "New Jobs", "Completed", "Revenue", "Extra Tasks"].map((h) => (
                <th key={h} style={{ padding: "9px 12px", fontWeight: 700, fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 18, textAlign: "center", color: COLORS.faint }}>Pick a valid From/To range.</td></tr>
            )}
            {days.map((d) => {
              const isBusy = d.newJobs + d.completedJobs + d.extraTasksDone > 0;
              return (
                <tr key={d.date.getTime()} style={{ borderTop: `1px solid ${COLORS.border}`, opacity: isBusy ? 1 : 0.55 }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700 }}>{fmtDate(d.date.getTime())}</td>
                  <td style={{ padding: "9px 12px", fontFamily: FONT_MONO }}>{d.newJobs}</td>
                  <td style={{ padding: "9px 12px", fontFamily: FONT_MONO }}>{d.completedJobs}</td>
                  <td style={{ padding: "9px 12px", fontFamily: FONT_MONO }}>{fmtMoney(d.revenue)}</td>
                  <td style={{ padding: "9px 12px", fontFamily: FONT_MONO }}>{d.extraTasksDone}</td>
                </tr>
              );
            })}
          </tbody>
          {days.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: COLORS.panel2 }}>
                <td style={{ padding: "9px 12px", fontWeight: 700 }}>Total</td>
                <td style={{ padding: "9px 12px", fontFamily: FONT_MONO, fontWeight: 700 }}>{dayTotals.newJobs}</td>
                <td style={{ padding: "9px 12px", fontFamily: FONT_MONO, fontWeight: 700 }}>{dayTotals.completedJobs}</td>
                <td style={{ padding: "9px 12px", fontFamily: FONT_MONO, fontWeight: 700 }}>{fmtMoney(dayTotals.revenue)}</td>
                <td style={{ padding: "9px 12px", fontFamily: FONT_MONO, fontWeight: 700 }}>{dayTotals.extraTasksDone}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Modal>
  );
}

/* Drill-down modal: every single job ID a technician has ever handled
   (optionally narrowed to a date range by intake date), with full job
   context in one row — customer, device, status, dates, and invoice
   amount/payment status — so Admin/Front Desk can audit exactly what a
   technician worked on, not just the counts from the summary table. */
function TechnicianJobDetailReportModal({ tech, jobs, invoices, onClose }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const techJobs = jobs.filter((j) => j.assignedTech === tech?.id);
  const filteredJobs = useMemo(() => {
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : null;
    return techJobs
      .filter((j) => (!fromTs || j.intake >= fromTs) && (!toTs || j.intake <= toTs))
      .sort((a, b) => b.intake - a.intake);
  }, [techJobs, from, to]);

  function invoiceFor(jobId) {
    return invoices.find((inv) => inv.jobId === jobId) || null;
  }

  function exportJobsCsv() {
    const header = ["Job ID", "Customer", "Phone", "Brand", "Model", "Status", "Intake Date", "Last Update", "Invoice Amount", "Payment Status"];
    const dataRows = filteredJobs.map((j) => {
      const inv = invoiceFor(j.id);
      const lastUpdate = j.updates[j.updates.length - 1]?.ts;
      return [
        j.id, j.customer, j.phone, j.brand, j.model, STATUS_META[j.status]?.label || j.status,
        fmtDateTime(j.intake), lastUpdate ? fmtDateTime(lastUpdate) : "", inv ? inv.total : "", inv ? inv.paymentStatus : "",
      ];
    });
    downloadCsv(`${(tech?.name || "technician").replace(/\s+/g, "-").toLowerCase()}-job-details_${todayYYYYMMDD()}.csv`, [header, ...dataRows]);
  }

  if (!tech) return null;

  return (
    <Modal title={`Job Details — ${tech.name}`} onClose={onClose} width={760}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div style={{ minWidth: 150 }}>
          <Field label="From (optional)"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} /></Field>
        </div>
        <div style={{ minWidth: 150 }}>
          <Field label="To (optional)"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} /></Field>
        </div>
        <Btn size="sm" onClick={exportJobsCsv} disabled={filteredJobs.length === 0}>
          <Download size={13} /> Export CSV
        </Btn>
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.faint, marginBottom: 10 }}>
        {tech.type === "outdoor" ? "Outdoor" : "Indoor"} Technician · {filteredJobs.length} job{filteredJobs.length === 1 ? "" : "s"}
        {(from || to) ? ` · intake ${from ? fmtDate(new Date(from + "T00:00:00").getTime()) : "the beginning"} → ${to ? fmtDate(new Date(to + "T00:00:00").getTime()) : "today"}` : " · all time"}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 8, maxHeight: 440, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: COLORS.panel2, textAlign: "left", position: "sticky", top: 0 }}>
              {["Job ID", "Customer", "Device", "Status", "Intake", "Last Update", "Invoice"].map((h) => (
                <th key={h} style={{ padding: "8px 10px", fontWeight: 700, fontSize: 10.5, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", background: COLORS.panel2 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 18, textAlign: "center", color: COLORS.faint }}>No jobs found for this technician{(from || to) ? " in this range" : ""}.</td></tr>
            )}
            {filteredJobs.map((j) => {
              const inv = invoiceFor(j.id);
              const lastUpdate = j.updates[j.updates.length - 1]?.ts;
              return (
                <tr key={j.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: "8px 10px", fontFamily: FONT_MONO, fontWeight: 700, whiteSpace: "nowrap" }}>{j.id}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 600 }}>{j.customer}</div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint }}>{fmtPhone(j.phone)}</div>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{j.brand} {j.model}</td>
                  <td style={{ padding: "8px 10px" }}><Badge status={j.status} /></td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{fmtDate(j.intake)}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{lastUpdate ? fmtDate(lastUpdate) : "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {inv ? (
                      <>
                        {fmtMoney(inv.total)}{" "}
                        <span style={{ fontSize: 10, color: inv.paymentStatus === "Paid" ? COLORS.teal : COLORS.amber }}>({inv.paymentStatus})</span>
                      </>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  SMS LOG                                                                  */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  CLOCK-IN GATE — shown instead of the dashboard for Front Desk/Indoor/  */
/*  Outdoor logins until they clock in for the day. Requests a one-time    */
/*  GPS snapshot via the browser's Geolocation permission (not continuous  */
/*  tracking — browsers can't do that in the background).                 */
/* ---------------------------------------------------------------------- */
function ClockInGate({ role, userName, clockingIn, onClockIn, onSwitchLogin }) {
  const roleTitle = { frontdesk: "Front Desk", indoor_tech: "Indoor Technician", outdoor_tech: "Outdoor Technician" }[role] || role;
  return (
    <div style={{
      fontFamily: FONT_SANS,
      background: `radial-gradient(circle at 30% 20%, #1B222C 0%, ${COLORS.bg} 60%)`,
      color: COLORS.text, minHeight: 620, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: 14, border: `1px solid ${COLORS.border}`, padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ width: 60, height: 60, borderRadius: 999, background: COLORS.amberDim, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Clock size={28} color={COLORS.amber} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>Clock In to Start Your Shift</div>
        <div style={{ fontSize: 12.5, color: COLORS.faint, marginTop: 4, marginBottom: 22 }}>
          {userName} · {roleTitle} — job actions are locked until you clock in.
        </div>
        <Btn onClick={onClockIn} disabled={clockingIn} style={{ width: "100%", justifyContent: "center" }}>
          <Clock size={15} /> {clockingIn ? "Capturing location…" : "Clock In Now"}
        </Btn>
        <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 12, lineHeight: 1.5 }}>
          Your browser will ask for location permission — this captures a one-time GPS snapshot for the attendance log, not continuous tracking.
        </div>
        <button onClick={onSwitchLogin} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 12, marginTop: 18, cursor: "pointer", textDecoration: "underline" }}>
          Wrong login? Switch role
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  ATTENDANCE VIEW (Admin / Front Desk) — every clock-in/out with its     */
/*  one-time location snapshot, sorted most recent first.                  */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/*  SETTINGS (Admin) — SMS dispatch mode: Automatic sends a receipt SMS    */
/*  the instant a job card is created; Manual leaves it to the front-desk  */
/*  person to send via the Call/SMS/WhatsApp buttons on the job.           */
/* ---------------------------------------------------------------------- */
function SettingsView({ smsDispatchMode, setSmsDispatchMode, notificationSettings, setNotificationSettings, loginWindowSettings, setLoginWindowSettings }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 16 }}>Settings</div>
      <Panel style={{ padding: 18, maxWidth: 480, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>SMS Dispatch Mode</div>
        <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 14, lineHeight: 1.5 }}>
          Controls whether a receipt SMS goes out the instant a new job card is created.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            variant={smsDispatchMode === "automatic" ? "teal" : "outline"}
            onClick={() => setSmsDispatchMode("automatic")} style={{ flex: 1 }}
          >
            Automatic
          </Btn>
          <Btn
            variant={smsDispatchMode === "manual" ? "teal" : "outline"}
            onClick={() => setSmsDispatchMode("manual")} style={{ flex: 1 }}
          >
            Manual
          </Btn>
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 12, lineHeight: 1.5 }}>
          {smsDispatchMode === "automatic"
            ? "An SMS with the Job ID is sent to the customer automatically the moment a job card is saved."
            : "No SMS is sent automatically — front desk sends it manually from the job's Call/SMS/WhatsApp buttons when ready."}
        </div>
      </Panel>

      <LoginWindowSettingsPanel loginWindowSettings={loginWindowSettings} setLoginWindowSettings={setLoginWindowSettings} />

      <NotificationSettingsPanel notificationSettings={notificationSettings} setNotificationSettings={setNotificationSettings} />
    </div>
  );
}

/* Admin-only control panel: the daily login window (start/end time) for
   each technician role. Indoor and Outdoor Technicians can be given
   different windows — e.g. Indoor on a bench shift 9–8, Outdoor starting
   later for field visits. Any technician already logged in when their
   role's end time passes is force-logged-out by the effect in the root
   component; logging back in is blocked until the next start time. */
function LoginWindowSettingsPanel({ loginWindowSettings, setLoginWindowSettings }) {
  const patchWindow = (roleKey, patch) => {
    setLoginWindowSettings((s) => ({ ...s, [roleKey]: { ...(s[roleKey] || DEFAULT_LOGIN_WINDOW_SETTINGS[roleKey]), ...patch } }));
  };
  const roleRows = [
    { key: "indoor_tech", label: "Indoor Technician" },
    { key: "outdoor_tech", label: "Outdoor Technician" },
  ];

  return (
    <Panel style={{ padding: 18, maxWidth: 640, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Login Time Settings</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 16, lineHeight: 1.5 }}>
        Sets the daily window each technician role can log into the CRM. Outside this window the role is locked at login, and any active session is signed out automatically the moment the end time passes.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {roleRows.map((r) => {
          const cfg = loginWindowSettings[r.key] || DEFAULT_LOGIN_WINDOW_SETTINGS[r.key];
          return (
            <div key={r.key} style={{
              padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{r.label}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 160 }}>
                  <Field label="Login opens at">
                    <Input
                      type="time"
                      value={cfg.start}
                      onChange={(e) => patchWindow(r.key, { start: e.target.value || "09:00" })}
                    />
                  </Field>
                </div>
                <div style={{ minWidth: 160 }}>
                  <Field label="Login closes at">
                    <Input
                      type="time"
                      value={cfg.end}
                      onChange={(e) => patchWindow(r.key, { end: e.target.value || "20:00" })}
                    />
                  </Field>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 10 }}>
                {r.label}s can log in between <strong>{fmtHHMMDisplay(cfg.start)}</strong> and <strong>{fmtHHMMDisplay(cfg.end)}</strong> daily.
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* Admin-only control panel: per-role notification on/off + reminder
   delay, plus one shared sound preset — covers every reminder engine in
   the app (2-hour customer updates, 1-hour technician check-ins, 30-min
   unassigned-job nudges, and 30-min pre-visit reminders). */
function NotificationSettingsPanel({ notificationSettings, setNotificationSettings }) {
  const patchRole = (roleKey, patch) => {
    setNotificationSettings((s) => ({ ...s, [roleKey]: { ...s[roleKey], ...patch } }));
  };
  const patchTypeSound = (typeKey, patch) => {
    setNotificationSettings((s) => ({
      ...s,
      sounds: { ...s.sounds, [typeKey]: { ...(s.sounds[typeKey] || DEFAULT_NOTIFICATION_SOUND_CONFIG), ...patch } },
    }));
  };

  const patchLabelPrint = (patch) => {
    setNotificationSettings((s) => ({ ...s, labelPrint: { ...s.labelPrint, ...patch } }));
  };
  const patchLabelPrintEnforcement = (patch) => {
    setNotificationSettings((s) => ({ ...s, labelPrintEnforcement: { ...s.labelPrintEnforcement, ...patch } }));
  };
  const patchStandbyTv = (patch) => {
    setNotificationSettings((s) => ({ ...s, standbyTv: { ...s.standbyTv, ...patch } }));
  };

  const delayFieldsForRole = {
    admin: [
      { key: "customerReminderMin", label: "Customer Update Reminder (min)" },
      { key: "unassignedReminderMin", label: "Unassigned Job Reminder (min)" },
    ],
    frontdesk: [
      { key: "customerReminderMin", label: "Customer Update Reminder (min)" },
      { key: "unassignedReminderMin", label: "Unassigned Job Reminder (min)" },
    ],
    indoor_tech: [
      { key: "reminderMin", label: "Job Check-In Reminder (min)" },
    ],
    outdoor_tech: [
      { key: "previsitReminderMin", label: "Pre-Visit Reminder (min before visit)" },
    ],
  };

  return (
    <Panel style={{ padding: 18, maxWidth: 640 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Notification Settings</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 16, lineHeight: 1.5 }}>
        Turn reminders on or off and adjust how often each role gets nudged — Admin only. Changes apply immediately.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
        {Object.keys(NOTIFICATION_ROLE_META).map((roleKey) => {
          const settings = notificationSettings[roleKey] || {};
          const fields = delayFieldsForRole[roleKey];
          return (
            <div key={roleKey} style={{
              padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{NOTIFICATION_ROLE_META[roleKey].label}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn
                    size="sm" variant={settings.enabled ? "teal" : "outline"}
                    onClick={() => patchRole(roleKey, { enabled: true })}
                  >
                    On
                  </Btn>
                  <Btn
                    size="sm" variant={!settings.enabled ? "danger" : "outline"}
                    onClick={() => patchRole(roleKey, { enabled: false })}
                  >
                    Off
                  </Btn>
                </div>
              </div>
              {settings.enabled && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                  {fields.map((f) => (
                    <div key={f.key} style={{ minWidth: 200 }}>
                      <Field label={f.label}>
                        <Input
                          type="number" min={1}
                          value={settings[f.key] ?? ""}
                          onChange={(e) => patchRole(roleKey, { [f.key]: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </Field>
                    </div>
                  ))}
                </div>
              )}
              {!settings.enabled && (
                <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 8 }}>
                  Notifications are off for {NOTIFICATION_ROLE_META[roleKey].label} — no reminders will fire for this role.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Label Print Reminder</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Nudges Admin/Front Desk when a job card's label hasn't been printed yet. One shared rule for every job — Indoor jobs use a shorter delay since they're right there on the bench; Outdoor jobs get a longer one.
      </div>
      <div style={{
        padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, marginBottom: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Label Not Printed Reminder</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              size="sm" variant={notificationSettings.labelPrint?.enabled ? "teal" : "outline"}
              onClick={() => patchLabelPrint({ enabled: true })}
            >
              On
            </Btn>
            <Btn
              size="sm" variant={!notificationSettings.labelPrint?.enabled ? "danger" : "outline"}
              onClick={() => patchLabelPrint({ enabled: false })}
            >
              Off
            </Btn>
          </div>
        </div>
        {notificationSettings.labelPrint?.enabled && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Indoor Service Delay (min)">
                <Input
                  type="number" min={1}
                  value={notificationSettings.labelPrint?.indoorDelayMin ?? ""}
                  onChange={(e) => patchLabelPrint({ indoorDelayMin: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 200 }}>
              <Field label="Outdoor Service Delay (min)">
                <Input
                  type="number" min={1}
                  value={notificationSettings.labelPrint?.outdoorDelayMin ?? ""}
                  onChange={(e) => patchLabelPrint({ outdoorDelayMin: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 200 }}>
              <Field label="Snooze / Remind Me Later (min)">
                <Input
                  type="number" min={1}
                  value={notificationSettings.labelPrint?.snoozeMin ?? ""}
                  onChange={(e) => patchLabelPrint({ snoozeMin: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>
          </div>
        )}
        {!notificationSettings.labelPrint?.enabled && (
          <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 8 }}>
            Label print reminders are off — no "label not printed" nudges will fire for any job.
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Label Print Enforcement</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 12, lineHeight: 1.5 }}>
        When on, a job whose label hasn't been printed yet cannot be moved forward to the next status from Update Job — Admin/Front Desk must print the label first. Re-saving the same status (e.g. adding a note) is never blocked.
      </div>
      <div style={{
        padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, marginBottom: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Require Label Print Before Job Progresses</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              size="sm" variant={notificationSettings.labelPrintEnforcement?.enabled ? "teal" : "outline"}
              onClick={() => patchLabelPrintEnforcement({ enabled: true })}
            >
              On
            </Btn>
            <Btn
              size="sm" variant={!notificationSettings.labelPrintEnforcement?.enabled ? "danger" : "outline"}
              onClick={() => patchLabelPrintEnforcement({ enabled: false })}
            >
              Off
            </Btn>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 8 }}>
          {notificationSettings.labelPrintEnforcement?.enabled
            ? "On — jobs with an unprinted label are locked to their current status until the label is printed."
            : "Off — jobs can move through statuses freely regardless of label print status (reminders above still nudge, but nothing is blocked)."}
        </div>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Standby TV Return Reminder</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 12, lineHeight: 1.5 }}>
        When Admin/Front Desk hands a customer a standby TV (from a job stuck on Waiting for Spares / Spares Not Available), this nudges them once the agreed number of days is up, so the loaner actually gets collected back.
      </div>
      <div style={{
        padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, marginBottom: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Standby TV Due-Back Nudge</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              size="sm" variant={notificationSettings.standbyTv?.enabled ? "teal" : "outline"}
              onClick={() => patchStandbyTv({ enabled: true })}
            >
              On
            </Btn>
            <Btn
              size="sm" variant={!notificationSettings.standbyTv?.enabled ? "danger" : "outline"}
              onClick={() => patchStandbyTv({ enabled: false })}
            >
              Off
            </Btn>
          </div>
        </div>
        {notificationSettings.standbyTv?.enabled && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Remind Me Later (min)">
                <Input
                  type="number" min={1}
                  value={notificationSettings.standbyTv?.snoozeMin ?? ""}
                  onChange={(e) => patchStandbyTv({ snoozeMin: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
            </div>
          </div>
        )}
        {!notificationSettings.standbyTv?.enabled && (
          <div style={{ fontSize: 11.5, color: COLORS.faint, marginTop: 8 }}>
            Standby TV reminders are off — no "collect it back" nudges will fire, though the Standby TVs list still shows every loan and its due date.
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Notification Sounds</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Each notification type below has its own sound — pick a preset or upload an audio file (MP3, WAV, up to {(MAX_CUSTOM_SOUND_BYTES / 1024 / 1024).toFixed(1)} MB) for any of them.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.keys(NOTIFICATION_TYPE_META).map((typeKey) => (
          <SoundConfigRow
            key={typeKey}
            label={NOTIFICATION_TYPE_META[typeKey].label}
            config={notificationSettings.sounds[typeKey] || DEFAULT_NOTIFICATION_SOUND_CONFIG}
            onChange={(patch) => patchTypeSound(typeKey, patch)}
          />
        ))}
      </div>
    </Panel>
  );
}

/* One notification type's sound picker — presets, upload-your-own audio
   file, and a Test button. Reused once per entry in NOTIFICATION_TYPE_META
   so every notification can have a genuinely different sound. */
function SoundConfigRow({ label, config, onChange }) {
  const [uploadError, setUploadError] = useState("");

  const handleUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setUploadError("That doesn't look like an audio file — please choose an MP3, WAV, or similar.");
      return;
    }
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      setUploadError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — please choose one under ${(MAX_CUSTOM_SOUND_BYTES / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    setUploadError("");
    const reader = new FileReader();
    reader.onload = () => onChange({ customSoundUrl: reader.result, customSoundName: file.name, sound: "custom" });
    reader.onerror = () => setUploadError("Couldn't read that file — please try again.");
    reader.readAsDataURL(file);
  };

  const removeUpload = () => {
    onChange({ customSoundUrl: null, customSoundName: null, sound: config.sound === "custom" ? "chime" : config.sound });
  };

  return (
    <div style={{ padding: "12px 14px", borderRadius: 9, background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {NOTIFICATION_SOUND_OPTIONS.map((opt) => (
          <Btn
            key={opt.value} size="sm"
            variant={config.sound === opt.value ? "teal" : "outline"}
            onClick={() => onChange({ sound: opt.value })}
          >
            {opt.label}
          </Btn>
        ))}
        <Btn
          size="sm"
          variant={config.sound === "custom" ? "teal" : "outline"}
          disabled={!config.customSoundUrl}
          onClick={() => onChange({ sound: "custom" })}
        >
          Custom{config.customSoundName ? ` (${config.customSoundName})` : ""}
        </Btn>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
          fontSize: 11.5, fontWeight: 600, color: COLORS.blue, padding: "6px 10px",
          border: `1px solid ${COLORS.border}`, borderRadius: 7, background: COLORS.panel,
        }}>
          <Upload size={12} /> Upload File
          <input type="file" accept="audio/*" onChange={handleUpload} style={{ display: "none" }} />
        </label>
        {config.customSoundUrl && (
          <Btn size="sm" variant="outline" onClick={removeUpload}>
            <Trash2 size={12} /> Remove
          </Btn>
        )}
        <Btn size="sm" variant="outline" onClick={() => playConfiguredSound(config.sound, config.customSoundUrl)}>
          <Bell size={12} /> Test
        </Btn>
      </div>
      {uploadError && (
        <div style={{ fontSize: 11, color: COLORS.red, marginTop: 6 }}>{uploadError}</div>
      )}
    </div>
  );
}

function AttendanceView({ attendance, tick }) {
  const sorted = [...attendance].sort((a, b) => b.clockIn - a.clockIn);
  const onShift = sorted.filter((a) => !a.clockOut);
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>Staff Attendance</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 16 }}>
        {onShift.length} currently on shift · location is a one-time snapshot captured at clock-in/out, not a live continuous track.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No attendance records yet.</div>}
        {sorted.map((a) => {
          const inLink = mapsLink(a.clockInLocation);
          const outLink = mapsLink(a.clockOutLocation);
          const durationMs = (a.clockOut || Date.now()) - a.clockIn;
          const hrs = (durationMs / H).toFixed(1);
          return (
            <Panel key={a.id} style={{ padding: 14, display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>
                {a.userName.split(" ").map((x) => x[0]).join("")}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{a.userName}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: COLORS.muted, background: COLORS.panel2, padding: "2px 7px", borderRadius: 999 }}>
                    {a.role === "frontdesk" ? "Front Desk" : a.role === "indoor_tech" ? "Indoor Tech" : "Outdoor Tech"}
                  </span>
                  {!a.clockOut && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.teal, background: COLORS.tealDim, padding: "2px 7px", borderRadius: 999, display: "flex", alignItems: "center", gap: 3 }}>
                      <CircleDot size={9} /> On shift
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                  In: {fmtDateTime(a.clockIn)}{inLink && <> · <a href={inLink} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.blue }}>view location</a></>}
                  {!a.clockInLocation && <span style={{ color: COLORS.faint }}> · location unavailable</span>}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                  {a.clockOut ? (
                    <>Out: {fmtDateTime(a.clockOut)}{outLink && <> · <a href={outLink} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.blue }}>view location</a></>}</>
                  ) : (
                    <span style={{ color: COLORS.faint }}>Still clocked in · {timeAgo(a.clockIn, tick)}</span>
                  )}
                </div>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: 700, color: COLORS.text }}>{hrs}h</div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* Admin-only live GPS view of every technician, indoor and outdoor.
   Shows a "Live" badge with a fresh position when that technician's own
   session has reported one recently (see the live-tracking effect near
   the top of the app); otherwise falls back to their last known location
   from clock-in, clearly labeled as such rather than implied to be
   current. */
function LiveTrackingView({ technicians, attendance, liveLocations, tick }) {
  const LIVE_FRESH_MS = 2 * 60 * 1000; // treat a fix as "live" for 2 minutes after it arrives

  const rows = technicians.map((t) => {
    const openShift = attendance.find((a) => a.userId === t.id && !a.clockOut && isSameDay(a.clockIn));
    const live = liveLocations[t.id];
    const isLiveFresh = !!(live && Date.now() - live.ts < LIVE_FRESH_MS);
    const lastAttendance = [...attendance]
      .filter((a) => a.userId === t.id && a.clockInLocation)
      .sort((a, b) => b.clockIn - a.clockIn)[0];
    const location = isLiveFresh ? live : (lastAttendance ? lastAttendance.clockInLocation : null);
    return { tech: t, onShift: !!openShift, isLiveFresh, location, live, lastAttendance };
  });

  const liveCount = rows.filter((r) => r.isLiveFresh).length;

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>Live Technician Tracking</div>
      <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 12 }}>
        {liveCount} of {technicians.length} technician{technicians.length === 1 ? "" : "s"} reporting a live position right now.
      </div>
      <div style={{
        fontSize: 11.5, color: COLORS.faint, background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
        borderRadius: 8, padding: "10px 12px", marginBottom: 16, lineHeight: 1.5,
      }}>
        A technician shows "Live" only while their own phone/session is actively open in the app with location permission granted — this demo runs as a single browser session, so at most one technician can be live here at a time. On a real multi-device rollout, every technician's phone reports independently, so all of them can be live simultaneously. Anyone not currently live falls back to their last known location from clock-in.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(({ tech, onShift, isLiveFresh, location, live, lastAttendance }) => {
          const link = mapsLink(location);
          return (
            <Panel key={tech.id} style={{ padding: 14, display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>
                {tech.name.split(" ").map((x) => x[0]).join("")}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{tech.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: COLORS.muted, background: COLORS.panel2, padding: "2px 7px", borderRadius: 999 }}>
                    {tech.type === "outdoor" ? "Outdoor" : "Indoor"}
                  </span>
                  {onShift ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.teal, background: COLORS.tealDim, padding: "2px 7px", borderRadius: 999 }}>
                      On Shift
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.faint, background: COLORS.panel2, padding: "2px 7px", borderRadius: 999, border: `1px solid ${COLORS.border}` }}>
                      Off Shift
                    </span>
                  )}
                  {isLiveFresh && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.teal, display: "flex", alignItems: "center", gap: 3 }}>
                      <CircleDot size={9} /> Live
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
                  {tech.specialty}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                  {location ? (
                    <>
                      <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.blue }}>View on map</a>
                      {" · "}
                      {isLiveFresh
                        ? <>updated {timeAgo(live.ts, tick)}</>
                        : lastAttendance
                        ? <span style={{ color: COLORS.faint }}>last known — clocked in {timeAgo(lastAttendance.clockIn, tick)}</span>
                        : null}
                    </>
                  ) : (
                    <span style={{ color: COLORS.faint }}>No location on file yet.</span>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
        {technicians.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No technicians on file yet.</div>}
      </div>
    </div>
  );
}


function SmsLogView({ log }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 16 }}>SMS Notification Log</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {log.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5 }}>No messages sent yet.</div>}
        {log.map((s, i) => (
          <Panel key={i} style={{ padding: 13, display: "flex", gap: 12 }}>
            <MessageSquare size={15} color={COLORS.blue} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 3 }}>
                To <span style={{ fontFamily: FONT_MONO, color: COLORS.muted }}>{s.phone}</span> · {s.jobId} · {fmtDateTime(s.ts)}
              </div>
              <div style={{ fontSize: 13, color: COLORS.text }}>{s.message}</div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PRINT VIEWS                                                             */
/* ---------------------------------------------------------------------- */
function PrintChrome({ onBack, onPrinted, children }) {
  const printRef = useRef(null);
  const native = isNativeShell();
  return (
    <div style={{ background: "#fff", color: "#111", minHeight: 620, borderRadius: 14, padding: 24, fontFamily: FONT_SANS }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "#EEE", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
          <ArrowLeft size={14} /> Back to CRM
        </button>
        <button
          onClick={() => { smartPrint(printRef); if (onPrinted) onPrinted(); }}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#1A1300", color: "#F0A63A", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
        >
          <Printer size={14} /> {native ? "Print / Share" : "Print"}
        </button>
      </div>
      {native && (
        <div className="no-print" style={{ fontSize: 11.5, color: "#888", marginBottom: 14, lineHeight: 1.5 }}>
          On a phone, this opens the share sheet — pick your label/receipt printer app, or "Print" if you have a print service installed.
        </div>
      )}
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div ref={printRef}>{children}</div>
    </div>
  );
}

function PrintLabel({ job, onBack, onMarkPrinted }) {
  return (
    <PrintChrome onBack={onBack} onPrinted={() => onMarkPrinted && onMarkPrinted(job.id)}>
      <div className="print-chrome-inner" style={{
        width: 380, maxWidth: "100%", border: "2px solid #111", borderRadius: 10, padding: 18, fontFamily: FONT_MONO, boxSizing: "border-box",
      }}>
        <div style={{ borderBottom: "2px solid #111", paddingBottom: 5, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", lineHeight: 1.2 }}>
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" }}>AITECHLAB LED TV SERVICE CENTER</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, lineHeight: 1.15, marginTop: 1 }}>{fmtPhone("6383647753")}</div>
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{job.customerId || "—"}</div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap", marginBottom: 4 }}>{job.id}</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div><strong>Customer:</strong> {job.customer}</div>
          <div><strong>Device:</strong> {job.brand} {job.model}</div>
          <div><strong>Issue:</strong> {job.issue}</div>
          <div><strong>Accessories:</strong> {job.accessories || "—"}</div>
          <div><strong>Location:</strong> {job.location || "________________"}</div>
          <div><strong>Intake:</strong> {fmtDateTime(job.intake)}</div>
        </div>
        <div style={{ marginTop: 14, borderTop: "1px dashed #111", paddingTop: 8, fontSize: 10, letterSpacing: 0.5, textAlign: "center", whiteSpace: "nowrap" }}>
          KEEP THIS LABEL ATTACHED TO THE UNIT · {job.id}
        </div>
      </div>
    </PrintChrome>
  );
}

function PrintInvoice({ invoice, job, onBack }) {
  return (
    <PrintChrome onBack={onBack}>
      <div style={{ maxWidth: 620, width: "100%", margin: "0 auto", border: "1px solid #ccc", borderRadius: 10, padding: 28, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 14, marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>AitechLab CRM</div>
            <div style={{ fontSize: 11.5, color: "#555" }}>LED / LCD Television Sales &amp; Service</div>
            <div style={{ fontSize: 11.5, color: "#555" }}>Coimbatore, Tamil Nadu · +91 98765 00000</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 16 }}>{invoice.id}</div>
            <div style={{ fontSize: 11.5, color: "#555" }}>{fmtDate(invoice.createdAt)}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18, fontSize: 12.5 }} className="form-grid-2col">
          <div><strong>Billed to:</strong> {invoice.customer}</div>
          <div><strong>Job Card:</strong> {invoice.jobId}</div>
          {job && <div><strong>Device:</strong> {job.brand} {job.model}</div>}
          <div><strong>Payment Method:</strong> {invoice.paymentMethod}</div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #111" }}>
              <th style={{ textAlign: "left", padding: "6px 0" }}>Description</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "7px 0" }}>{it.desc}</td>
                <td style={{ padding: "7px 0", textAlign: "right", fontFamily: FONT_MONO }}>{fmtMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 220, maxWidth: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, borderTop: "2px solid #111", paddingTop: 8 }}>
              <span>Total</span><span style={{ fontFamily: FONT_MONO }}>{fmtMoney(invoice.total)}</span>
            </div>
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                background: invoice.paymentStatus === "Paid" ? "#DFF5EE" : "#FFF3D6",
                color: invoice.paymentStatus === "Paid" ? "#0F7A5C" : "#8A5B00",
              }}>
                {invoice.paymentStatus === "Paid" ? "PAID" : "PAYMENT PENDING"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 26, fontSize: 10.5, color: "#888", textAlign: "center", borderTop: "1px dashed #ccc", paddingTop: 10 }}>
          Thank you for choosing AitechLab CRM. This is a system-generated invoice.
        </div>
      </div>
    </PrintChrome>
  );
}
