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
/*  it up to a print dialog at all.                                       */
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
    console.warn("smartPrint: image share unavailable, falling back to text share.", err);
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: document.title, text: "Open this and choose Print from the share sheet." });
    } catch {
      window.print();
    }
  }
}

/* ---------------------------------------------------------------------- */
/*  DESIGN TOKENS — "Bench Diagnostics" theme                             */
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
  glass: "rgba(255,255,255,0.68)",
  glass2: "rgba(255,255,255,0.82)",
  glassBorder: "rgba(124,58,237,0.16)",
  glassHighlight: "rgba(255,255,255,0.55)",
};

const FONT_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
const FONT_SANS = "'Inter', 'Segoe UI', system-ui, sans-serif";

const now = Date.now();
const H = 3600000;

const REMINDER_INTERVAL_MS = 2 * H;
const REMINDER_POLL_MS = 60 * 1000;
const TECH_REMINDER_INTERVAL_MS = 1 * H;
const UNASSIGNED_TECH_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

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

const DEFAULT_NOTIFICATION_SETTINGS = {
  admin: { enabled: true, customerReminderMin: 120, unassignedReminderMin: 30 },
  frontdesk: { enabled: true, customerReminderMin: 120, unassignedReminderMin: 30 },
  indoor_tech: { enabled: true, reminderMin: 60 },
  outdoor_tech: { enabled: true, previsitReminderMin: 30 },
  labelPrint: { enabled: true, indoorDelayMin: 30, outdoorDelayMin: 60, snoozeMin: 10 },
  labelPrintEnforcement: { enabled: false },
  standbyTv: { enabled: true, snoozeMin: 60 },
  sounds: Object.fromEntries(Object.keys(NOTIFICATION_TYPE_META).map((k) => [k, { ...DEFAULT_NOTIFICATION_SOUND_CONFIG }])),
};

const MAX_CUSTOM_SOUND_BYTES = 1.5 * 1024 * 1024;

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

const DEFAULT_FAULTS = [
  ...Object.keys(SUB_FAULTS),
  "No Power / Dead Set",
  "Sound Not Working",
  "Panel / Screen Damage",
  "Other",
];

const GENERAL_FAULT_OPTIONS = ["No Audio", "No Video", "No Power On", "Dead", "Display Broken", "Display Lines"];
const SPARE_WAIT_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
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

function playConfiguredSound(type, customUrl) {
  if (!type || type === "silent") return;
  if (type === "custom") {
    if (!customUrl) return;
    try {
      const audio = new Audio(customUrl);
      audio.volume = 0.85;
      audio.play().catch(() => {});
    } catch (e) {}
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    if (type === "beep") {
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
  } catch (e) {}
}

function playNotificationTypeSound(notificationSettings, typeKey) {
  const cfg = (notificationSettings?.sounds && notificationSettings.sounds[typeKey]) || DEFAULT_NOTIFICATION_SOUND_CONFIG;
  playConfiguredSound(cfg.sound, cfg.customSoundUrl);
}

function waLink(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

function telLink(phone) {
  return `tel:${String(phone || "").replace(/\D/g, "")}`;
}

function fireBrowserNotification(title, body, tag) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      const n = new Notification(title, { body, tag, renotify: true });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch {}
}

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

const DEFAULT_LOGIN_WINDOW_SETTINGS = {
  indoor_tech: { start: "09:00", end: "20:00" },
  outdoor_tech: { start: "09:00", end: "20:00" },
};

function parseHHMM(str) {
  const [h, m] = String(str || "09:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function isWithinLoginWindow(windowCfg, d = new Date()) {
  const startMin = parseHHMM(windowCfg?.start);
  const endMin = parseHHMM(windowCfg?.end);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  if (startMin === endMin) return true;
  return startMin < endMin ? (nowMin >= startMin && nowMin < endMin) : (nowMin >= startMin || nowMin < endMin);
}

function fmtHHMMDisplay(str) {
  const [h, m] = String(str || "09:00").split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${period}`;
}

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

const ACTIVE_JOB_STATUSES = [
  "received", "pending_diagnosis", "under_diagnosis", "fault_identified",
  "awaiting_approval", "waiting_for_spares", "in_repair",
];

const REMINDER_STOP_STATUSES = [
  "ready_for_delivery", "delivered", "not_ready", "approval_rejected",
  "return_requested", "returned_unrepaired", "feedback_pending", "closed",
];

function labelPrintDelayMs(notificationSettings, jobType) {
  const s = notificationSettings?.labelPrint || {};
  const min = jobType === "outdoor" ? (s.outdoorDelayMin || 60) : (s.indoorDelayMin || 30);
  return min * 60 * 1000;
}

function labelPrintSnoozeMs(notificationSettings) {
  const s = notificationSettings?.labelPrint || {};
  return (s.snoozeMin || 10) * 60 * 1000;
}

function standbyTvSnoozeMs(notificationSettings) {
  const s = notificationSettings?.standbyTv || {};
  return (s.snoozeMin || 60) * 60 * 1000;
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
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

const navBackStack = [];
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
  }, [isOpen, id]);
  useEffect(() => () => { if (wasOpenRef.current) popNavBack(id); }, [id]);
}

export default function AitechLabCRM() {
  const [role, setRole] = useState(null);
  const [activeTechId, setActiveTechId] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [newJobScreenOpenedAt, setNewJobScreenOpenedAt] = useState(null);

  const [technicians, setTechnicians] = useFirestoreArrayState("technicians", "id");
  const [parts, setParts] = useFirestoreArrayState("parts", "id");
  const [jobs, setJobs] = useFirestoreArrayState("jobs", "id", "intake");
  const [customers, setCustomers] = useFirestoreArrayState("customers", "customerId", "createdAt");
  const [invoices, setInvoices] = useFirestoreArrayState("invoices", "id", "createdAt");
  const [smsLog, appendSmsLog] = useFirestoreLogState("smsLog", "ts");

  const [toast, setToast] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(null);
  const [confirmDeleteTech, setConfirmDeleteTech] = useState(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(null);

  const [labelPrintReminderQueue, setLabelPrintReminderQueue] = useState([]);
  const [labelPrintReminderPopup, setLabelPrintReminderPopup] = useState(null);
  const [standbyLoans, setStandbyLoans] = useFirestoreArrayState("standbyLoans", "id", "givenAt");
  const [givingStandbyFor, setGivingStandbyFor] = useState(null);
  const [standbyTvReminderQueue, setStandbyTvReminderQueue] = useState([]);
  const [standbyTvReminderPopup, setStandbyTvReminderPopup] = useState(null);
  
  const [notificationSettings, setNotificationSettings] = useFirestoreValueState("settings", "notifications", DEFAULT_NOTIFICATION_SETTINGS);
  const [loginWindowSettings, setLoginWindowSettings] = useFirestoreValueState("settings", "loginWindow", DEFAULT_LOGIN_WINDOW_SETTINGS);

  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const standbyLoansRef = useRef(standbyLoans);
  useEffect(() => { standbyLoansRef.current = standbyLoans; }, [standbyLoans]);

  const pushToast = (msg, type = "ok") => setToast({ msg, type, id: Date.now() });

  function snoozeStandbyReminder(reminder) {
    setStandbyLoans((ls) => ls.map((l) => (l.id === reminder.id ? { ...l, nextReminderAt: Date.now() + standbyTvSnoozeMs(notificationSettings) } : l)));
    setStandbyTvReminderQueue((q) => q.filter((r) => r.id !== reminder.id));
    setStandbyTvReminderPopup(null);
    pushToast(`Snoozed — you'll be reminded again in ${(notificationSettings?.standbyTv || {}).snoozeMin || 60} minutes for ${reminder.jobId}.`, "ok");
  }

  return (
    <div style={{ padding: 20, color: COLORS.text, fontFamily: FONT_SANS }}>
      <h2>AitechLab CRM System</h2>
      <p>Current Active Role: {role || "None selected"}</p>
      {toast && (
        <div style={{ padding: 10, background: toast.type === "alert" ? COLORS.redDim : COLORS.tealDim, color: COLORS.text, borderRadius: 6, marginBottom: 10 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}