import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Tv, LayoutDashboard, ClipboardList, Wrench, Package, Receipt, Users,
  MessageSquare, Plus, Printer, Search, X, Bell, RefreshCw, CheckCircle2,
  Clock, AlertTriangle, LogOut, Phone, ChevronRight, IndianRupee,
  Banknote, CreditCard, Smartphone, Trash2, UserCircle2, ArrowLeft,
  PackagePlus, PackageMinus, TrendingUp, CircleDot, Menu, Camera, MapPin, Eye
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/*  smartPrint — window.print() works fine in the browser, but Android's  */
/*  native WebView (used when this runs as a Capacitor app) doesn't wire  */
/*  it up to a print dialog. This checks if we're in a Capacitor native   */
/*  shell and falls back to the OS share sheet (from which the user can   */
/*  pick "Print" on both iOS and Android) instead of a silent no-op.      */
/*  Swap the native branch for @capacitor/share or a PDF-generation lib   */
/*  if you want a one-tap print instead of the share-sheet detour.        */
/* ---------------------------------------------------------------------- */
function isNativeShell() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

async function smartPrint() {
  if (!isNativeShell()) {
    window.print();
    return;
  }
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: document.title, text: "Open this and choose Print from the share sheet." });
  } catch {
    window.print(); // fallback if @capacitor/share isn't installed yet
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

const REMINDER_STATUS_OPTIONS = [
  { label: "In Progress", jobStatus: "In Progress" },
  { label: "Spare Ordered", jobStatus: "In Progress" },
  { label: "Ready for Delivery", jobStatus: "Completed" },
  { label: "Completed", jobStatus: "Completed" },
];

/* How many days a technician can pick when marking a job "Spare Ordered" —
   during this window the 2-hour reminder cycle pauses in favor of one
   check-in per day. */
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

/* Closing line appended to the "detailed status update" WhatsApp message,
   keyed by the status the technician picked in the reminder popup. */
const STATUS_CLOSING_NOTE = {
  "In Progress": "We are currently working on component replacement.",
  "Spare Ordered": "We have ordered the required spare part and will update you once it arrives.",
  "Ready for Delivery": "Your TV is ready for delivery. Please visit at your convenience.",
  Completed: "Repair work is completed. Please collect your TV at your convenience.",
};

/* Builds the templated WhatsApp message for a reminder. Stage 1 = initial
   diagnosis prompt (fired soon after intake); stage "daily" = the once-a-day
   check-in that replaces 2-hour reminders while a spare part is on order;
   stage 2+ = a detailed section-wise status update. `reason`/`customReason`
   apply when statusLabel is "In Progress"; `days` applies when it's
   "Spare Ordered". */
function buildReminderMessage(reminder, statusLabel, days, reason, customReason) {
  const subText = reminder.subFaults && reminder.subFaults.length ? ` (${reminder.subFaults.join(", ")})` : "";
  if (reminder.stage === 1) {
    return `Hello, your TV (Job #${reminder.jobId}) has been inspected. Identified issue: ${reminder.fault}${subText}. We will update you shortly on progress.`;
  }
  if (reminder.stage === "daily") {
    const remaining = reminder.spareWaitUntil ? Math.max(1, Math.ceil((reminder.spareWaitUntil - Date.now()) / (24 * H))) : null;
    return `Hello! Daily update on your TV (Job #${reminder.jobId}): the spare part is still on order${remaining ? ` — approximately ${remaining} more day${remaining > 1 ? "s" : ""}` : ""}. Thank you for your patience.`;
  }
  const issues = reminder.subFaults && reminder.subFaults.length ? reminder.subFaults.join(", ") : reminder.fault;
  let closing = STATUS_CLOSING_NOTE[statusLabel] || "We will keep you posted.";
  if (statusLabel === "Spare Ordered" && days) {
    closing = `We have ordered the required spare part. Please wait ${days} day${days > 1 ? "s" : ""} — we will update you once it arrives.`;
  } else if (statusLabel === "In Progress" && reason) {
    closing = `${[reason, (customReason || "").trim()].filter(Boolean).join(" — ")}.`;
  }
  return `Hello! Status update for TV Job #${reminder.jobId}: Main Category: ${reminder.fault}. Identified Issues: ${issues}. ${closing}`;
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

/* Short triple-beep alarm using the Web Audio API — no external audio
   file/asset needed, so it works the moment the tab has had a user
   gesture (required by browser autoplay policy). */
function playAlarmBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    [0, 0.28, 0.56].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1046.5, t0 + offset);
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.24);
    });
    setTimeout(() => ctx.close(), 1400);
  } catch {
    /* audio isn't critical — swallow so the reminder still fires */
  }
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

const SEED_TECHS = [
  { id: "T1", name: "Ravi Kumar", phone: "9876500011", specialty: "Panel & Backlight", type: "indoor" },
  { id: "T2", name: "Suresh Babu", phone: "9876500022", specialty: "Power & SMPS", type: "indoor" },
  { id: "T3", name: "Priya Ganesan", phone: "9876500033", specialty: "Mainboard & T-Con", type: "indoor" },
  { id: "T4", name: "Manikandan S", phone: "9876500044", specialty: "Field Visits & On-site Diagnosis", type: "outdoor" },
];

const SEED_PARTS = [
  { id: "P1", name: "LED Panel Strip (32\")", qty: 14, cost: 650, low: 5 },
  { id: "P2", name: "LED Panel Strip (55\")", qty: 6, cost: 1450, low: 4 },
  { id: "P3", name: "SMPS Power Board", qty: 9, cost: 980, low: 3 },
  { id: "P4", name: "T-Con Board", qty: 4, cost: 1650, low: 3 },
  { id: "P5", name: "Main Board (Universal)", qty: 3, cost: 2200, low: 2 },
  { id: "P6", name: "IR Remote Sensor", qty: 22, cost: 120, low: 8 },
  { id: "P7", name: "HDMI Port Board", qty: 11, cost: 380, low: 5 },
  { id: "P8", name: "Speaker Set (Pair)", qty: 8, cost: 450, low: 4 },
  { id: "P9", name: "Capacitor Repair Kit", qty: 17, cost: 90, low: 6 },
  { id: "P10", name: "Ribbon Cable (LVDS)", qty: 2, cost: 260, low: 4 },
];

const SEED_JOBS = [
  {
    id: "JC-1001", customer: "Anitha Raman", phone: "9843211001", customerId: "CID-260810-014", location: "RS Puram, Coimbatore",
    brand: "Samsung", model: "UA43T5350", issue: "No display, faint backlight visible",
    accessories: "Remote, power cable", estimate: 2200, fault: "Backlight Fault", subFaults: ["LED Strip Burning / Damage"], remindersSent: 0,
    intake: now - 5.5 * H, status: "Pending", assignedTech: null, partsUsed: [],
    createdBy: "frontdesk",
    updates: [{ ts: now - 5.5 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" }],
    invoiced: false,
  },
  {
    id: "JC-1002", customer: "Mohammed Irfan", phone: "9843211002", customerId: "CID-260812-007", location: "Gandhipuram, Coimbatore",
    brand: "LG", model: "43LM6360", issue: "Vertical lines across screen",
    accessories: "None", estimate: 3200, fault: "Display Fault", subFaults: ["Pixel Shorting", "CKV / Gate Signal Shorting"], remindersSent: 0,
    intake: now - 3.2 * H, status: "In Progress", assignedTech: "T1", partsUsed: [],
    createdBy: "frontdesk",
    updates: [
      { ts: now - 3.2 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" },
      { ts: now - 2.6 * H, by: "Ravi Kumar", note: "Diagnosed T-Con board fault. Ordering part.", status: "In Progress" },
    ],
    invoiced: false,
  },
  {
    id: "JC-1003", customer: "Deepa Selvam", phone: "9843211003", customerId: "CID-260805-002", location: "Peelamedu, Coimbatore",
    brand: "Sony", model: "KLV-32R422", issue: "TV not powering on",
    accessories: "Power cable only", estimate: 1400, fault: "SMPS / Power Supply Board", subFaults: ["Primary Switching Section Fault"], remindersSent: 0,
    intake: now - 26 * H, status: "Completed", assignedTech: "T2", partsUsed: [{ partId: "P3", qty: 1 }],
    createdBy: "frontdesk",
    updates: [
      { ts: now - 26 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" },
      { ts: now - 20 * H, by: "Suresh Babu", note: "SMPS board dead. Replacement needed.", status: "In Progress" },
      { ts: now - 4 * H, by: "Suresh Babu", note: "SMPS board replaced and tested OK.", status: "Completed" },
    ],
    invoiced: false,
  },
  {
    id: "JC-0998", customer: "Karthik Subramaniam", phone: "9843210998", customerId: "CID-260601-041", location: "Saibaba Colony, Coimbatore",
    brand: "Mi", model: "L50M6-EI", issue: "Cracked panel, physical damage",
    accessories: "Remote", estimate: 5200, fault: "Panel / Screen Damage", subFaults: [], remindersSent: 0,
    intake: now - 50 * H, status: "Delivered", assignedTech: "T3", partsUsed: [{ partId: "P2", qty: 1 }],
    createdBy: "frontdesk",
    updates: [
      { ts: now - 50 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" },
      { ts: now - 46 * H, by: "Priya Ganesan", note: "Panel replacement confirmed with customer.", status: "In Progress" },
      { ts: now - 30 * H, by: "Priya Ganesan", note: "Panel replaced, picture restored.", status: "Completed" },
      { ts: now - 6 * H, by: "Admin", note: "Delivered to customer.", status: "Delivered" },
    ],
    invoiced: true,
  },
];

/* ---------------------------------------------------------------------- */
/*  CUSTOMERS (CID layer) — every inbound enquiry/call becomes a customer  */
/*  record before it's ever a job. A CID with no linked job is a live      */
/*  enquiry/lead; converting it via "+ Create Job" issues a JID and links  */
/*  the two records, mirroring the Customers/Jobs schema from the Android  */
/*  Call Launcher architecture doc.                                        */
/* ---------------------------------------------------------------------- */
const SEED_CUSTOMERS = [
  {
    customerId: "CID-260810-014", name: "Anitha Raman", phone: "9843211001", location: "RS Puram, Coimbatore",
    status: "Active Customer", source: "Inbound Call",
    notes: [{ ts: now - 5.6 * H, by: "Front Desk", note: "Called about no-display issue on 43\" Samsung. Booked drop-off same day." }],
    createdAt: now - 5.6 * H,
  },
  {
    customerId: "CID-260812-007", name: "Mohammed Irfan", phone: "9843211002", location: "Gandhipuram, Coimbatore",
    status: "Active Customer", source: "Inbound Call",
    notes: [{ ts: now - 3.3 * H, by: "Front Desk", note: "Lines across screen, wants a quick turnaround before the weekend." }],
    createdAt: now - 3.3 * H,
  },
  {
    customerId: "CID-260805-002", name: "Deepa Selvam", phone: "9843211003", location: "Peelamedu, Coimbatore",
    status: "Active Customer", source: "Walk-in",
    notes: [],
    createdAt: now - 26.2 * H,
  },
  {
    customerId: "CID-260601-041", name: "Karthik Subramaniam", phone: "9843210998", location: "Saibaba Colony, Coimbatore",
    status: "Active Customer", source: "Referral",
    notes: [{ ts: now - 50.5 * H, by: "Front Desk", note: "Referred by Deepa Selvam. Cracked panel, wants OEM part only." }],
    createdAt: now - 50.5 * H,
  },
  {
    customerId: "CID-260815-023", name: "Lakshmi Narayanan", phone: "9876543210", location: "Ganapathy, Coimbatore",
    status: "Enquiry / Lead", source: "Inbound Call",
    notes: [{ ts: now - 20 * H, by: "Front Desk", note: "Asked about backlight repair cost for a 43\" Samsung. Quoted ₹2,000–2,500, said she'd call back — no drop-off yet." }],
    createdAt: now - 20 * H,
  },
];

const SEED_INVOICES = [
  {
    id: "INV-5001", jobId: "JC-0998", customer: "Karthik Subramaniam",
    items: [
      { desc: "LED Panel Strip (55\") x1", amount: 1450 },
      { desc: "Service & Labor Charge", amount: 900 },
    ],
    total: 2350, paymentMethod: "GPay", paymentStatus: "Paid",
    createdAt: now - 6 * H, paidAt: now - 6 * H,
  },
];

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

const STATUS_META = {
  Pending: { color: COLORS.red, bg: COLORS.redDim, label: "Pending" },
  "In Progress": { color: COLORS.amber, bg: COLORS.amberDim, label: "In Progress" },
  Completed: { color: COLORS.teal, bg: COLORS.tealDim, label: "Completed" },
  Delivered: { color: COLORS.blue, bg: "rgba(46,125,214,0.16)", label: "Delivered" },
};

const PAY_ICON = { Cash: Banknote, GPay: Smartphone, "Credit Card": CreditCard };

/* Pending orders surface first everywhere; within a status, the longest-waiting job leads. */
const STATUS_PRIORITY = { Pending: 0, "In Progress": 1, Completed: 2, Delivered: 3 };
const sortByUrgency = (list) =>
  [...list].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.intake - b.intake;
  });

let invCounter = 5002;
const nextInvId = () => `INV-${invCounter++}`;

/* ---------------------------------------------------------------------- */
/*  CID / JID GENERATOR — daily-sequenced IDs, e.g. CID-20260816-001,      */
/*  JID-20260816-8000. Mirrors the next_daily_id() Postgres function from  */
/*  the Android Call Launcher architecture doc, so the same ID scheme      */
/*  works whether a record originates from the phone app or this web app. */
/*  Job numbers start at 8000 each day; CID numbers start at 001.          */
/* ---------------------------------------------------------------------- */
const dailyIdCounters = {};
const DAILY_ID_CONFIG = {
  JID: { start: 8000, pad: 0 },
  CID: { start: 1, pad: 3 },
};
function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}
function nextDailyId(prefix) {
  const cfg = DAILY_ID_CONFIG[prefix] || { start: 1, pad: 3 };
  const key = `${prefix}-${todayYYYYMMDD()}`;
  if (dailyIdCounters[key] === undefined) dailyIdCounters[key] = cfg.start - 1;
  dailyIdCounters[key] += 1;
  const numStr = cfg.pad ? String(dailyIdCounters[key]).padStart(cfg.pad, "0") : String(dailyIdCounters[key]);
  return `${key}-${numStr}`;
}

/* ---------------------------------------------------------------------- */
/*  SMALL UI PRIMITIVES                                                    */
/* ---------------------------------------------------------------------- */
function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.Pending;
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

function Btn({ children, onClick, variant = "default", size = "md", style, disabled, type = "button" }) {
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
/*  ROOT APP                                                               */
/* ---------------------------------------------------------------------- */
export default function AitechLabCRM() {
  const [role, setRole] = useState(null); // 'admin' | 'frontdesk' | 'technician'
  const [activeTechId, setActiveTechId] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [technicians, setTechnicians] = useState(SEED_TECHS);
  const [parts, setParts] = useState(SEED_PARTS);
  const [jobs, setJobs] = useState(SEED_JOBS);
  const [customers, setCustomers] = useState(SEED_CUSTOMERS);
  const [invoices, setInvoices] = useState(SEED_INVOICES);
  const [smsLog, setSmsLog] = useState([
    { ts: now - 6 * H, phone: "9843210998", jobId: "JC-0998", message: "Hi Karthik, payment of ₹2,350 received via GPay. Thank you!" },
  ]);

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

  const toastTimer = useRef(null);
  const prevOverdueCount = useRef(null);
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  /* live "time ago" ticker */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  /* automated dashboard refresh — polls every 30s; jobs pending/in-progress for
     over 2h are flagged overdue, and a toast fires only when that count changes */
  useEffect(() => {
    const REFRESH_MS = 30 * 1000;
    const OVERDUE_THRESHOLD_MS = 2 * H;
    const t = setInterval(() => {
      setLastRefresh(Date.now());
      const overdue = jobs.filter(
        (j) => (j.status === "Pending" || j.status === "In Progress") && Date.now() - j.intake > OVERDUE_THRESHOLD_MS
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
      const currentJobs = jobsRef.current;
      const newReminders = [];
      const updated = currentJobs.map((j) => {
        if (j.status === "Completed" || j.status === "Delivered") return j;

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
        const elapsedStages = Math.floor((Date.now() - baseline) / REMINDER_INTERVAL_MS);
        const sent = j.remindersSent || 0;
        if (elapsedStages > sent) {
          const nextStage = sent + 1;
          newReminders.push({
            id: `${j.id}-r${nextStage}`,
            jobId: j.id, stage: nextStage, ts: Date.now(), jobStatus: j.status,
            fault: j.fault, subFaults: j.subFaults || [], phone: j.phone,
            customer: j.customer, brand: j.brand, model: j.model,
          });
          return { ...j, remindersSent: nextStage };
        }
        return j;
      });

      if (newReminders.length) {
        setJobs(updated);
        newReminders.forEach((r) => {
          playAlarmBeep();
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
        const inProgressReminder = [...newReminders].reverse().find((r) => r.jobStatus === "In Progress");
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
  }, []);

  /* auto-stop: the moment a job's status flips to Completed/Delivered
     (from anywhere in the app), drop any reminder card still showing
     for it — no more timers, no more badge count for that Job ID. */
  useEffect(() => {
    setReminders((rs) => rs.filter((r) => {
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && j.status !== "Completed" && j.status !== "Delivered";
    }));
    setPopupReminder((r) => {
      if (!r) return r;
      const j = jobs.find((jj) => jj.id === r.jobId);
      return j && j.status !== "Completed" && j.status !== "Delivered" ? r : null;
    });
  }, [jobs]);

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

  function pushToast(message, kind = "sms") {
    setToast({ message, kind, id: Math.random() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }

  function sendSms(phone, jobId, message) {
    setSmsLog((l) => [{ ts: Date.now(), phone, jobId, message }, ...l]);
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
  function sendReminderUpdate(channel, reminder, statusLabel, days, reason, customReason) {
    const message = buildReminderMessage(reminder, statusLabel, days, reason, customReason);

    if (channel === "whatsapp") {
      window.open(waLink(reminder.phone, message), "_blank", "noopener,noreferrer");
      setSmsLog((l) => [{ ts: Date.now(), phone: reminder.phone, jobId: reminder.jobId, message: `[WhatsApp] ${message}` }, ...l]);
      pushToast(`WhatsApp update opened for ${reminder.jobId}.`, "sms");
    } else {
      sendSms(reminder.phone, reminder.jobId, message);
    }

    if (reminder.stage > 1 && statusLabel) {
      const opt = REMINDER_STATUS_OPTIONS.find((o) => o.label === statusLabel);
      if (opt) {
        const reasonBit = statusLabel === "In Progress" && reason
          ? ` (${[reason, (customReason || "").trim()].filter(Boolean).join(" — ")})`
          : "";
        const patch = {
          status: opt.jobStatus,
          note: `Reminder update — customer notified: ${statusLabel}${statusLabel === "Spare Ordered" && days ? ` (${days}-day wait)` : ""}${reasonBit}.`,
          by: "Reminder System",
        };
        if (statusLabel === "Spare Ordered" && days) {
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
    }
    setReminders((rs) => rs.filter((r) => r.id !== reminder.id));
    setPopupReminder((r) => (r && r.id === reminder.id ? null : r));
  }
  const sendWhatsAppUpdate = (reminder, statusLabel, days, reason, customReason) =>
    sendReminderUpdate("whatsapp", reminder, statusLabel, days, reason, customReason);
  const sendSmsUpdate = (reminder, statusLabel, days, reason, customReason) =>
    sendReminderUpdate("sms", reminder, statusLabel, days, reason, customReason);

  function dismissReminder(reminderId) {
    setReminders((rs) => rs.filter((r) => r.id !== reminderId));
    setPopupReminder((r) => (r && r.id === reminderId ? null : r));
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
    setSmsLog((l) => [{ ts: Date.now(), phone: job.phone, jobId: job.id, message: `[WhatsApp] ${message}` }, ...l]);
    pushToast(`WhatsApp opened for ${job.id}.`, "sms");
  }
  function sendSmsToJob(job) {
    sendSms(job.phone, job.id, buildJobUpdateMessage(job));
  }

  function sendWhatsAppToCustomer(customer) {
    const message = buildCustomerUpdateMessage(customer);
    window.open(waLink(customer.phone, message), "_blank", "noopener,noreferrer");
    setSmsLog((l) => [{ ts: Date.now(), phone: customer.phone, jobId: customer.customerId, message: `[WhatsApp] ${message}` }, ...l]);
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
    setSmsLog((l) => [{ ts: Date.now(), phone: job.phone, jobId: job.id, message: `[Call] Called ${job.customer}.` }, ...l]);
  }
  function callCustomer(customer) {
    window.location.href = telLink(customer.phone);
    setSmsLog((l) => [{ ts: Date.now(), phone: customer.phone, jobId: customer.customerId, message: `[Call] Called ${customer.name || customer.customerId}.` }, ...l]);
  }
  function callReminder(reminder) {
    window.location.href = telLink(reminder.phone);
    setSmsLog((l) => [{ ts: Date.now(), phone: reminder.phone, jobId: reminder.jobId, message: `[Call] Called ${reminder.customer}.` }, ...l]);
  }

  const techMap = useMemo(() => Object.fromEntries(technicians.map((t) => [t.id, t])), [technicians]);
  const partMap = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p])), [parts]);

  const overdueJobs = useMemo(
    () => jobs.filter((j) =>
      (j.status === "Pending" || j.status === "In Progress") &&
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
    () => jobs.filter((j) => j.status === "Pending" || j.status === "In Progress"),
    [jobs]
  );

  /* ---------------- job actions ---------------- */
  function createJob(data, creator = { role: "frontdesk", label: "Front Desk", techId: null }) {
    const id = data.id || nextDailyId("JID");
    const job = {
      id, ...data, intake: Date.now(), status: "Pending",
      assignedTech: creator.techId || null,
      partsUsed: [], createdBy: creator.role, invoiced: false, remindersSent: 0,
      updates: [{ ts: Date.now(), by: creator.label, note: "Job card created on intake.", status: "Pending" }],
    };
    setJobs((j) => [job, ...j]);
    sendSms(data.phone, id, `Hi ${data.customer}, your ${data.brand} ${data.model} has been received. Job ID: ${id}. We'll update you on progress.`);
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

  function createCustomer({ phone, name, note, location, source = "Inbound Call" }) {
    const existing = findCustomerByPhone(phone);
    if (existing) {
      if (note) addCustomerNote(existing.customerId, note, "Front Desk");
      if (location) updateCustomer(existing.customerId, { location });
      return existing;
    }
    const customerId = nextDailyId("CID");
    const record = {
      customerId, name: name || "", phone, location: location || "", status: "Enquiry / Lead", source,
      notes: note ? [{ ts: Date.now(), by: "Front Desk", note }] : [],
      createdAt: Date.now(),
    };
    setCustomers((cs) => [record, ...cs]);
    pushToast(`New enquiry logged — ${customerId}.`, "ok");
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

  function updateJob(jobId, { status, note, partsUsedDelta, by, fault, subFaults, readyPhoto, location, spareWaitDays, spareOrderedAt, spareWaitUntil, dailyRemindersSent }) {
    setJobs((js) =>
      js.map((j) => {
        if (j.id !== jobId) return j;
        let partsUsed = j.partsUsed;
        if (partsUsedDelta && partsUsedDelta.length) {
          partsUsed = [...j.partsUsed];
          partsUsedDelta.forEach(({ partId, qty }) => {
            const idx = partsUsed.findIndex((p) => p.partId === partId);
            if (idx >= 0) partsUsed[idx] = { ...partsUsed[idx], qty: partsUsed[idx].qty + qty };
            else partsUsed.push({ partId, qty });
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
        const used = partsUsedDelta.find((d) => d.partId === p.id);
        return used ? { ...p, qty: Math.max(0, p.qty - used.qty) } : p;
      }));
    }
    const job = jobs.find((j) => j.id === jobId);
    if (job) {
      const parts_txt = partsUsedDelta && partsUsedDelta.length
        ? ` Parts used: ${partsUsedDelta.map((d) => `${partMap[d.partId]?.name} x${d.qty}`).join(", ")}.`
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
  function submitRepairReport(jobId, status, remarks, by) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const alreadyApproved = job.approvalStage === "confirmed" || job.approvalStage === "acknowledged";
    const isCompleting = status === "Completed" && alreadyApproved;

    setJobs((js) => js.map((j) => {
      if (j.id !== jobId) return j;
      if (isCompleting) {
        return {
          ...j, status, repairRemarks: remarks, invoiced: true,
          updates: [...j.updates, { ts: Date.now(), by, note: `Repair completed: ${remarks}. Invoice generated.`, status }],
        };
      }
      if (alreadyApproved) {
        return {
          ...j, status: status || j.status, repairRemarks: remarks,
          updates: [...j.updates, { ts: Date.now(), by, note: `Repair update: ${remarks}`, status: status || j.status }],
        };
      }
      return {
        ...j, status: status || j.status, repairRemarks: remarks, approvalStage: "pending_review",
        updates: [...j.updates, { ts: Date.now(), by, note: `Repair diagnosis submitted: ${remarks}`, status: status || j.status }],
      };
    }));

    if (isCompleting) {
      const partItems = job.partsUsed.map((pu) => ({
        desc: `${partMap[pu.partId]?.name || pu.partId} x${pu.qty}`,
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
      ...j, approvalStage: "declined", status: "Completed", invoiced: true,
      updates: [...j.updates, { ts: Date.now(), by, note: "Customer did not approve the repair — pack up TV for return. Service charge invoice generated.", status: "Completed" }],
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
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, approvalStage: "declined_acknowledged" } : j)));
  }

  function createInvoice(job, laborCharge, paymentMethod, paymentStatus) {
    const partItems = job.partsUsed.map((pu) => ({
      desc: `${partMap[pu.partId]?.name || pu.partId} x${pu.qty}`,
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
  if (printJob) return <PrintLabel job={printJob} onBack={() => setPrintJob(null)} />;
  if (printInvoice) return <PrintInvoice invoice={printInvoice} job={jobs.find((j) => j.id === printInvoice.jobId)} onBack={() => setPrintInvoice(null)} />;

  /* ------------------------------------------------------------------ */
  /*  LOGIN / ROLE SELECT                                                 */
  /* ------------------------------------------------------------------ */
  if (!role) {
    return (
      <RoleSelect
        technicians={technicians}
        onSelect={(r, techId) => { setRole(r); setActiveTechId(techId || null); setTab("dashboard"); }}
      />
    );
  }

  const NAV = {
    admin: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "customers", label: "Customers (CID)", icon: Phone },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
      { id: "inventory", label: "Inventory", icon: Package },
      { id: "technicians", label: "Technicians", icon: Users },
      { id: "sms", label: "SMS Log", icon: MessageSquare },
    ],
    frontdesk: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "customers", label: "Customers (CID)", icon: Phone },
      { id: "newjob", label: "New Job Card", icon: Plus },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
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
          overdueCount={overdueJobs.length}
          lastRefresh={lastRefresh}
          tick={tick}
          showAlerts={showAlerts}
          setShowAlerts={setShowAlerts}
          overdueJobs={overdueJobs}
          reminders={reminders}
          onSendWhatsApp={sendWhatsAppUpdate}
          onSendSms={sendSmsUpdate}
          onCall={callReminder}
          onDismissReminder={dismissReminder}
          repairAlerts={(role === "admin" || role === "frontdesk") ? repairAlerts : []}
          onReviewRepairRequest={(jobId, estimate, serviceCharge) => reviewRepairRequest(jobId, estimate, serviceCharge, roleLabel[role] || "Office")}
          onConfirmCustomerApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
          onDeclineCustomerApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
          onManualRefresh={() => {
            setLastRefresh(Date.now());
            pushToast(`Dashboard refreshed manually. ${overdueJobs.length} order(s) need attention.`, "alert");
          }}
          onOpenNav={() => setMobileNavOpen(true)}
        />

        <div className="main-scroll" style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {tab === "dashboard" && role === "admin" && (
            <Dashboard
              jobs={jobs} invoices={invoices} technicians={technicians} parts={parts}
              revenueToday={revenueToday} outstandingDues={outstandingDues} pendingOrders={pendingOrders}
              overdueJobs={overdueJobs} tick={tick} onOpenJob={(j) => { setTab("jobcards"); }}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: roleLabel[role] || "Office" })}
              onWhatsApp={sendWhatsAppToJob}
              onSms={sendSmsToJob}
              onCall={callJob}
              onPrint={setPrintInvoice}
              onConfirmApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
              onDeclineApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
              smsLog={smsLog}
            />
          )}

          {tab === "dashboard" && role === "frontdesk" && (
            <FrontDeskDashboard
              jobs={jobs} technicians={technicians} tick={tick} parts={parts}
              onAssign={assignTech} onPrintLabel={setPrintJob}
              onSms={sendSmsToJob}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: roleLabel[role] || "Office" })}
              onWhatsApp={sendWhatsAppToJob}
              onCall={callJob}
              onConfirmApproval={(jobId) => confirmCustomerApproval(jobId, roleLabel[role] || "Office")}
              onDeclineApproval={(jobId) => declineCustomerApproval(jobId, roleLabel[role] || "Office")}
              smsLog={smsLog}
            />
          )}

          {tab === "dashboard" && (role === "indoor_tech" || role === "outdoor_tech") && (
            <TechnicianDashboard
              role={role} tech={techMap[activeTechId]}
              onAddJob={() => setTab("newjob")}
              onAddCustomer={() => setAddingCustomer(true)}
              onMyJobs={() => setTab("myjobs")}
            />
          )}

          {tab === "myjobs" && role === "indoor_tech" && (
            <MyJobsView
              jobs={jobs.filter((j) => j.assignedTech === activeTechId)} tick={tick}
              onSubmitRepairReport={(jobId, status, remarks) => submitRepairReport(jobId, status, remarks, techMap[activeTechId]?.name || "Technician")}
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
              parts={parts}
              smsLog={smsLog}
            />
          )}

          {tab === "billing" && (
            <Billing
              jobs={jobs} invoices={invoices} parts={parts} role={role}
              onCreateInvoice={createInvoice} onMarkPaid={markInvoicePaid}
              onPrint={setPrintInvoice} revenueToday={revenueToday} outstandingDues={outstandingDues}
            />
          )}

          {tab === "inventory" && <Inventory parts={parts} setParts={setParts} />}

          {tab === "technicians" && <TechniciansView technicians={technicians} setTechnicians={setTechnicians} jobs={jobs} onRequestDelete={setConfirmDeleteTech} />}

          {tab === "sms" && <SmsLogView log={smsLog} />}
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
            {jobs.some((j) => j.assignedTech === confirmDeleteTech.id && j.status !== "Delivered") && (
              <>
                {" "}They have{" "}
                <strong style={{ color: COLORS.amber }}>
                  {jobs.filter((j) => j.assignedTech === confirmDeleteTech.id && j.status !== "Delivered").length} active job(s)
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

      {popupReminder && (
        <Modal title={`2-Hour Reminder — Job #${popupReminder.jobId}`} onClose={() => setPopupReminder(null)} width={440}>
          <ReminderPopupBody
            reminder={popupReminder}
            onSendWhatsApp={(statusLabel, days, reason, customReason) => sendWhatsAppUpdate(popupReminder, statusLabel, days, reason, customReason)}
            onSendSms={(statusLabel, days, reason, customReason) => sendSmsUpdate(popupReminder, statusLabel, days, reason, customReason)}
            onCall={() => callReminder(popupReminder)}
            onClose={() => setPopupReminder(null)}
          />
        </Modal>
      )}

      {confirmedRepairPopup && (
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

      {declinedRepairPopup && (
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

      {addingCustomer && (
        <Modal title="Log Call / New Enquiry" onClose={() => setAddingCustomer(false)} width={440}>
          <LogCallForm
            customers={customers}
            onSubmit={(data) => { createCustomer(data); setAddingCustomer(false); }}
            onCancel={() => setAddingCustomer(false)}
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
function RoleSelect({ technicians, onSelect }) {
  const [pickingRole, setPickingRole] = useState(null); // null | "indoor_tech" | "outdoor_tech"
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
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => (r.id === "indoor_tech" || r.id === "outdoor_tech" ? setPickingRole(r.id) : onSelect(r.id))}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "16px 16px", borderRadius: 11,
                  background: "rgba(255,255,255,0.85)", backdropFilter: "blur(10px)",
                  border: "1px solid rgba(255,255,255,0.7)", cursor: "pointer", textAlign: "left",
                  boxShadow: "0 8px 22px rgba(80,20,120,0.18)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#a78bfa")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.7)")}
              >
                <div style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(139,92,246,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <r.icon size={19} color="#7C3AED" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#2B1A4A" }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "#6B5B8A", marginTop: 1 }}>{r.desc}</div>
                </div>
                <ChevronRight size={17} color="#9B8AB5" />
              </button>
            ))}
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
function TopBar({ role, overdueCount, lastRefresh, tick, showAlerts, setShowAlerts, overdueJobs, reminders, onSendWhatsApp, onSendSms, onCall, onDismissReminder, repairAlerts = [], onReviewRepairRequest, onConfirmCustomerApproval, onDeclineCustomerApproval, onManualRefresh, onOpenNav }) {
  const titles = { admin: "Dashboard", frontdesk: "Front Desk", indoor_tech: "Indoor Technician", outdoor_tech: "Outdoor Technician" };
  const reminderCount = reminders.length + repairAlerts.length;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px", borderBottom: `1px solid ${COLORS.glassBorder}`,
      background: COLORS.glass, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
      gap: 10, flexWrap: "wrap",
    }}>
      <style>{`
        @keyframes bellPulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0 ${COLORS.red}66; }
          70%  { transform: scale(1.12); box-shadow: 0 0 0 6px ${COLORS.red}00; }
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
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
            zIndex: 40, padding: 12, maxHeight: "70vh", overflowY: "auto",
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
                  <Clock size={12} color={COLORS.amber} /> 2-Hour Reminders
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {reminders.map((r) => (
                    <ReminderRow key={r.id} reminder={r} onSendWhatsApp={onSendWhatsApp} onSendSms={onSendSms} onCall={onCall} onDismiss={onDismissReminder} />
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

function ReminderRow({ reminder, onSendWhatsApp, onSendSms, onCall, onDismiss }) {
  const [status, setStatus] = useState(REMINDER_STATUS_OPTIONS[0].label);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const isInitial = reminder.stage === 1;
  const isDaily = reminder.stage === "daily";

  const sendArgs = [
    reminder,
    isInitial || isDaily ? undefined : status,
    status === "Spare Ordered" ? days : undefined,
    status === "In Progress" ? reason : undefined,
    status === "In Progress" ? customReason : undefined,
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
      {!isInitial && !isDaily && (
        <>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginBottom: status === "Spare Ordered" || status === "In Progress" ? 6 : 8, fontSize: 12 }}>
            {REMINDER_STATUS_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
          </Select>
          {status === "Spare Ordered" && (
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ marginBottom: 8, fontSize: 12 }}>
              {SPARE_WAIT_DAY_OPTIONS.map((d) => <option key={d} value={d}>Wait {d} day{d > 1 ? "s" : ""}</option>)}
            </Select>
          )}
          {status === "In Progress" && (
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
function ReminderPopupBody({ reminder, onSendWhatsApp, onSendSms, onCall, onClose }) {
  const [status, setStatus] = useState(REMINDER_STATUS_OPTIONS[0].label);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const isDaily = reminder.stage === "daily";
  const sendArgs = [
    isDaily ? undefined : status,
    status === "Spare Ordered" ? days : undefined,
    status === "In Progress" ? reason : undefined,
    status === "In Progress" ? customReason : undefined,
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
          {status === "Spare Ordered" && (
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
          {status === "In Progress" && (
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
function FaultSelector({ fault, setFault, subFaults, setSubFaults }) {
  const options = SUB_FAULTS[fault] || [];

  const toggle = (key) => {
    setSubFaults((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Main Fault Category">
        <Select value={fault} onChange={(e) => { setFault(e.target.value); setSubFaults([]); }}>
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
function TechnicianDashboard({ role, tech, onAddJob, onAddCustomer, onMyJobs }) {
  const roleTitle = role === "indoor_tech" ? "Indoor Technician" : "Outdoor Technician";
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
function MyJobsView({ jobs, tick, onSubmitRepairReport }) {
  const [detail, setDetail] = useState(null);
  const active = jobs.filter((j) => j.status !== "Delivered");
  const done = jobs.filter((j) => j.status === "Delivered");

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
                <span style={{ color: COLORS.faint }}>Parts used:</span> {detail.partsUsed.map((p) => `${p.partId} x${p.qty}`).join(", ")}
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

          {onSubmitRepairReport && detail.status !== "Delivered" && detail.approvalStage !== "declined" && detail.approvalStage !== "declined_acknowledged" && (
            <>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>
                Update Repair Status &amp; Remarks
              </div>
              <RepairReportForm
                job={detail}
                onSubmit={(status, remarks) => { onSubmitRepairReport(detail.id, status, remarks); setDetail(null); }}
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
function RepairReportForm({ job, onSubmit }) {
  const [status, setStatus] = useState(job.status === "Delivered" ? "Completed" : job.status);
  const [remarks, setRemarks] = useState("");

  return (
    <div>
      <Field label="Current TV Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["Pending", "In Progress", "Completed"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
      <div style={{ height: 10 }} />
      <Field label="Remarks / Solution">
        <TextArea
          value={remarks} onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. Backlight strip burnt, needs replacement. Repair possible, part on hand."
        />
      </Field>
      <div style={{ marginTop: 12 }}>
        <Btn disabled={!remarks.trim()} onClick={() => onSubmit(status, remarks.trim())}>
          <Wrench size={13} /> Submit for Approval
        </Btn>
      </div>
    </div>
  );
}

function Dashboard({ jobs, invoices, technicians, parts, revenueToday, outstandingDues, pendingOrders, overdueJobs, tick, onAddJob, onAddCustomer, onUpdate, onWhatsApp, onSms, onCall, onPrint, onConfirmApproval, onDeclineApproval, smsLog }) {
  const lowStock = parts.filter((p) => p.qty <= p.low);
  const workload = technicians.map((t) => ({
    ...t,
    active: jobs.filter((j) => j.assignedTech === t.id && (j.status === "Pending" || j.status === "In Progress")).length,
    completed: jobs.filter((j) => j.assignedTech === t.id && (j.status === "Completed" || j.status === "Delivered")).length,
  }));
  const maxActive = Math.max(1, ...workload.map((w) => w.active));
  const [showPendingList, setShowPendingList] = useState(false);
  const [showOverdueList, setShowOverdueList] = useState(false);
  const [showTotalRevenue, setShowTotalRevenue] = useState(false);
  const [totalRevFrom, setTotalRevFrom] = useState("");
  const [totalRevTo, setTotalRevTo] = useState("");
  const [detailJob, setDetailJob] = useState(null);
  const [editingJob, setEditingJob] = useState(null);

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
        <AddJobButton onClick={onAddJob} />
        <AddCustomerButton onClick={onAddCustomer} />
      </div>

      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pendingOrders.length} sub="Tap to view the list" accent={COLORS.amber} onClick={() => setShowPendingList(true)} />
        <StatCard icon={IndianRupee} label="Revenue Today" value={fmtMoney(revenueToday)} sub="Paid invoices, today" accent={COLORS.teal} />
        <StatCard icon={AlertTriangle} label="Outstanding Dues" value={fmtMoney(outstandingDues)} sub="Unpaid invoices" accent={COLORS.red} />
        <StatCard icon={Clock} label="Overdue (>2h)" value={overdueJobs.length} sub="Tap to view the list" accent={COLORS.red} onClick={() => setShowOverdueList(true)} />
      </div>

      {/* Nothing about total revenue is ever displayed here — the figure only
          appears once this button is tapped and the modal is opened. */}
      <Btn variant="outline" onClick={() => setShowTotalRevenue(true)} style={{ alignSelf: "flex-start" }}>
        <Eye size={14} /> View Total Revenue (Custom Dates)
      </Btn>

      {overdueJobs.length > 0 && (
        <Panel style={{ padding: 16, border: `1px solid ${COLORS.red}55`, background: `${COLORS.redDim}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={16} color={COLORS.red} />
            <span style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.text }}>Orders sitting {'>'} 2 hours without progress</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px,1fr))", gap: 8 }}>
            {overdueJobs.map((j) => (
              <div key={j.id} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "9px 11px" }}>
                <div
                  onClick={() => setDetailJob(j)}
                  style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, fontWeight: 700, cursor: "pointer" }}
                >
                  <span>{j.id}</span><Badge status={j.status} />
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{j.customer} — {j.brand} {j.model}</div>
                <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 2 }}>{timeAgo(j.intake, tick)}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                  <Btn size="sm" variant="outline" onClick={() => setEditingJob(j)} style={{ flex: 1, padding: "5px 6px" }}><Wrench size={11} /></Btn>
                  <Btn size="sm" variant="outline" onClick={() => onCall(j)} style={{ flex: 1, padding: "5px 6px" }}><Phone size={11} /></Btn>
                  <Btn size="sm" variant="outline" onClick={() => onSms(j)} style={{ flex: 1, padding: "5px 6px" }}><MessageSquare size={11} /></Btn>
                  <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)} style={{ flex: 1, padding: "5px 6px" }}><MessageSquare size={11} /></Btn>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

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

      {showOverdueList && (
        <Modal title={`Overdue Orders (${overdueJobs.length})`} onClose={() => setShowOverdueList(false)} width={520}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueJobs.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.faint }}>Nothing overdue — all clear.</div>}
            {sortByUrgency(overdueJobs).map((j) => (
              <div
                key={j.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 8,
                  background: COLORS.panel2, border: `1px solid ${COLORS.red}55`, flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => { setDetailJob(j); setShowOverdueList(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5 }}>{j.id}</span>
                  <span style={{ fontSize: 12.5, flex: 1, color: COLORS.muted }}>{j.customer} — {j.brand} {j.model}</span>
                  <span style={{ fontSize: 11, color: COLORS.red, fontFamily: FONT_MONO }}>{timeAgo(j.intake, tick)}</span>
                  <Badge status={j.status} />
                </button>
                <Btn size="sm" variant="outline" onClick={() => { setEditingJob(j); setShowOverdueList(false); }}><Wrench size={12} /> Edit</Btn>
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
          {detailJob.status !== "Delivered" && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
              <Btn onClick={() => { setEditingJob(detailJob); setDetailJob(null); }}>
                <Wrench size={14} /> Update Status
              </Btn>
            </div>
          )}
        </Modal>
      )}

      {editingJob && (
        <Modal title={`Update ${editingJob.id}`} onClose={() => setEditingJob(null)}>
          <UpdateJobForm
            job={editingJob} parts={parts}
            onSave={(payload) => { onUpdate(editingJob.id, payload); setEditingJob(null); }}
            onWhatsApp={onWhatsApp}
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
function FrontDeskDashboard({ jobs, technicians, tick, onAssign, onPrintLabel, onSms, onWhatsApp, onCall, onAddJob, onAddCustomer, parts, onUpdate, onConfirmApproval, onDeclineApproval, smsLog }) {
  const pending = sortByUrgency(jobs.filter((j) => j.status === "Pending" || j.status === "In Progress"));
  const pendingToday = pending.filter((j) => isSameDay(j.intake));
  const unassigned = pending.filter((j) => !j.assignedTech);
  const completed = jobs
    .filter((j) => j.status === "Completed" || j.status === "Delivered")
    .sort((a, b) => (b.updates[b.updates.length - 1]?.ts || 0) - (a.updates[a.updates.length - 1]?.ts || 0));
  const completedToday = completed.filter((j) => isSameDay(j.updates[j.updates.length - 1]?.ts || 0));
  const [showPendingList, setShowPendingList] = useState(false);
  const [detailJob, setDetailJob] = useState(null);
  const [editingJob, setEditingJob] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <AddJobButton onClick={onAddJob} />
        <AddCustomerButton onClick={onAddCustomer} />
      </div>

      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pending.length} sub="Tap to view the list" accent={COLORS.amber} onClick={() => setShowPendingList(true)} />
        <StatCard icon={Clock} label="Pending Today" value={pendingToday.length} sub="Intake received today" accent={COLORS.blue} />
        <StatCard icon={Users} label="Unassigned" value={unassigned.length} sub="Waiting on a technician" accent={COLORS.red} />
        <StatCard icon={CheckCircle2} label="Completed Today" value={completedToday.length} sub="Ready for billing / pickup" accent={COLORS.teal} />
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
            const overdue = Date.now() - j.intake > 2 * H;
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
                    {timeAgo(j.intake, tick)}{overdue && <span style={{ color: COLORS.red }}> · overdue</span>}
                  </div>
                </div>
                <Badge status={j.status} />
                {j.assignedTech ? (
                  <span style={{ fontSize: 11.5, color: COLORS.muted, width: 120 }}>{techMapName(technicians, j.assignedTech)}</span>
                ) : (
                  <Select onChange={(e) => e.target.value && onAssign(j.id, e.target.value)} defaultValue="" style={{ width: 140 }}>
                    <option value="" disabled>Assign tech…</option>
                    {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
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
          {detailJob.status !== "Delivered" && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
              <Btn onClick={() => { setEditingJob(detailJob); setDetailJob(null); }}>
                <Wrench size={14} /> Update Status
              </Btn>
            </div>
          )}
        </Modal>
      )}

      {editingJob && (
        <Modal title={`Update ${editingJob.id}`} onClose={() => setEditingJob(null)}>
          <UpdateJobForm
            job={editingJob} parts={parts}
            onSave={(payload) => { onUpdate(editingJob.id, payload); setEditingJob(null); }}
            onWhatsApp={onWhatsApp}
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
  // Reserve the Job ID the moment this form opens, so staff see exactly
  // which JID this intake will become before they even fill it in.
  const [previewId] = useState(() => nextDailyId("JID"));
  const blank = {
    customer: presetCustomer?.name || "", phone: presetCustomer?.phone || "", location: presetCustomer?.location || "",
    brand: "", model: "", issue: "", accessories: "", estimate: "", fault: DEFAULT_FAULTS[0],
  };
  const [f, setF] = useState(blank);
  const [subFaults, setSubFaults] = useState([]);
  const [faultPhoto, setFaultPhoto] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState(presetCustomer?.customerId || "");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setFault = (val) => setF((prev) => ({ ...prev, fault: val }));
  const valid = f.customer.trim() && f.phone.trim().length >= 10 && f.brand.trim() && f.model.trim() && f.issue.trim();

  const reset = () => { setF(blank); setSubFaults([]); setFaultPhoto(null); setSelectedCustomerId(presetCustomer?.customerId || ""); };

  const lastJobFor = (customerId) =>
    jobs.filter((j) => j.customerId === customerId).sort((a, b) => b.intake - a.intake)[0];

  const sortedCustomers = [...customers].sort((a, b) => b.createdAt - a.createdAt);

  function handleSelectCustomer(customerId) {
    setSelectedCustomerId(customerId);
    if (!customerId) return;
    const cust = customers.find((c) => c.customerId === customerId);
    if (!cust) return;
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
        <Field label="Customer Name"><Input value={f.customer} onChange={set("customer")} placeholder="e.g. Anitha Raman" /></Field>
        <Field label="Phone Number"><Input value={f.phone} onChange={set("phone")} placeholder="10-digit mobile" /></Field>
        <Field label="TV Brand"><Input value={f.brand} onChange={set("brand")} placeholder="e.g. Samsung, LG, Sony" /></Field>
        <Field label="Model Number"><Input value={f.model} onChange={set("model")} placeholder="e.g. UA43T5350" /></Field>
        <Field label="Accessories Brought"><Input value={f.accessories} onChange={set("accessories")} placeholder="Remote, cable, stand…" /></Field>
        <Field label="Estimated Cost (₹)"><Input type="number" value={f.estimate} onChange={set("estimate")} placeholder="Optional" /></Field>
        <Field label="Location"><Input value={f.location} onChange={set("location")} placeholder="e.g. RS Puram, Coimbatore" /></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Reported Issue"><TextArea value={f.issue} onChange={set("issue")} placeholder="Describe the fault as reported by customer…" /></Field>
      </div>
      <div style={{ marginTop: 16 }}>
        <FaultSelector fault={f.fault} setFault={setFault} subFaults={subFaults} setSubFaults={setSubFaults} />
      </div>
      <div style={{ marginTop: 16 }}>
        <PhotoUploadField label="Fault Photo" value={faultPhoto} onChange={setFaultPhoto} />
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn
          disabled={!valid}
          onClick={() => { onCreate({ ...f, id: previewId, estimate: Number(f.estimate) || 0, subFaults, faultPhoto, customerId: selectedCustomerId || null }); reset(); }}
        >
          <Plus size={14} /> Create Job Card &amp; Send SMS
        </Btn>
        {onSms && (
          <Btn
            variant="outline" disabled={!f.customer.trim() || f.phone.trim().length < 10}
            onClick={() => onSms({ id: previewId, customer: f.customer, phone: f.phone, brand: f.brand, model: f.model, status: "Pending", fault: f.fault, subFaults })}
          >
            <MessageSquare size={14} /> Send SMS
          </Btn>
        )}
        {onWhatsApp && (
          <Btn
            variant="teal" disabled={!f.customer.trim() || f.phone.trim().length < 10}
            onClick={() => onWhatsApp({ id: previewId, customer: f.customer, phone: f.phone, brand: f.brand, model: f.model, status: "Pending", fault: f.fault, subFaults })}
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
  if (!job.fault && (!job.subFaults || job.subFaults.length === 0)) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
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
function CustomersView({ customers, jobs, tick, role, onLogCall, onAddNote, onCreateJob, onWhatsApp, onSms, onCall, onRequestDelete }) {
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
        <Btn onClick={() => setLogging(true)}><Phone size={13} /> Log Call / New Enquiry</Btn>
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
        <Modal title="Log Call / New Enquiry" onClose={() => setLogging(false)} width={440}>
          <LogCallForm
            customers={customers}
            onSubmit={(data) => { onLogCall(data); setLogging(false); }}
            onCancel={() => setLogging(false)}
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
          />
        </Modal>
      )}
    </div>
  );
}

function LogCallForm({ customers, onSubmit, onCancel }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");

  const digits = phone.replace(/\D/g, "");
  const existing = digits.length >= 10 ? customers.find((c) => c.phone.replace(/\D/g, "") === digits) : null;
  const valid = digits.length >= 10;

  return (
    <div>
      <Field label="Phone Number">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" autoFocus />
      </Field>

      {existing ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: "10px 12px", background: COLORS.tealDim, border: `1px solid ${COLORS.teal}55`, borderRadius: 8 }}>
          <CheckCircle2 size={14} color={COLORS.teal} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>
            Returning caller — <strong style={{ fontFamily: FONT_MONO }}>{existing.customerId}</strong> ({existing.name || "name not on file"}).
            Your note will be added to their existing record instead of creating a duplicate CID.
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <Field label="Customer Name (optional if unknown yet)">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakshmi Narayanan" />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Location">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. RS Puram, Coimbatore" />
            </Field>
          </div>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <Field label="Enquiry Note">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked about backlight repair cost for a 43&quot; Samsung…" />
        </Field>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <Btn disabled={!valid} onClick={() => onSubmit({ phone, name, location, note })}>
          <Phone size={13} /> {existing ? "Add Note to Existing CID" : "Log New Enquiry"}
        </Btn>
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function CustomerDetail({ customer, jobs, tick, onAddNote, onCreateJob, onWhatsApp, onSms, onCall, onDelete }) {
  const [note, setNote] = useState("");
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
      </div>

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

function JobCardsList({ jobs, technicians, role, tick, onPrintLabel, onAssign, onSms, onWhatsApp, onCall, onRequestDelete, onUpdate, onConfirmApproval, onDeclineApproval, parts, smsLog = [] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);

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
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 170 }}>
          {["All", "Pending", "In Progress", "Completed", "Delivered"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && <div style={{ color: COLORS.faint, fontSize: 13 }}>No job cards match.</div>}
        {filtered.map((j) => {
          const inSpareWait = j.spareWaitUntil && Date.now() < j.spareWaitUntil;
          const overdue = (j.status === "Pending" || j.status === "In Progress") && Date.now() - j.intake > 2 * H && !inSpareWait;
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
                  <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /> Label</Btn>
                  <Btn size="sm" variant="outline" onClick={() => onCall(j)}><Phone size={13} /> Call</Btn>
                  <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /> SMS</Btn>
                  <Btn size="sm" variant="teal" onClick={() => onWhatsApp(j)}><MessageSquare size={13} /> WhatsApp</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setDetail(j)}>Details</Btn>
                  {j.status !== "Delivered" && (
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
            job={editing} parts={parts}
            onSave={(payload) => { onUpdate(editing.id, payload); setEditing(null); }}
            onWhatsApp={onWhatsApp}
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
            <span style={{ color: COLORS.faint }}>Parts used:</span> {job.partsUsed.map((p) => `${p.partId} x${p.qty}`).join(", ")}
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

function UpdateJobForm({ job, parts, onSave, onWhatsApp }) {
  const [status, setStatus] = useState(job.status);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(IN_PROGRESS_REASONS[0]);
  const [customFeedback, setCustomFeedback] = useState("");
  const [location, setLocation] = useState(job.location || "");
  const [fault, setFault] = useState(job.fault || DEFAULT_FAULTS[0]);
  const [subFaults, setSubFaults] = useState(job.subFaults || []);
  const [readyPhoto, setReadyPhoto] = useState(job.readyPhoto || null);
  const [partRows, setPartRows] = useState([{ partId: "", qty: 1 }]);

  const addRow = () => setPartRows((r) => [...r, { partId: "", qty: 1 }]);
  const removeRow = (i) => setPartRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i, field, val) => setPartRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  const validRows = partRows.filter((r) => r.partId && r.qty > 0);
  const isDelivering = status === "Delivered";
  const isInProgress = status === "In Progress";
  const canSave = !isDelivering || !!readyPhoto;

  const buildNote = () => {
    if (isInProgress) {
      return [reason, customFeedback.trim()].filter(Boolean).join(" — ") || "Status updated to In Progress.";
    }
    return note || `Status updated to ${status}.`;
  };

  return (
    <div>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["Pending", "In Progress", "Completed", "Delivered"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
      <div style={{ height: 12 }} />
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
        <Field label="Progress Note (sent to customer via SMS)">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Diagnosed T-Con board fault, replacing now…" />
        </Field>
      )}
      <div style={{ height: 14 }} />
      <FaultSelector fault={fault} setFault={setFault} subFaults={subFaults} setSubFaults={setSubFaults} />
      <div style={{ height: 14 }} />
      <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>Spare Parts Used</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {partRows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select value={row.partId} onChange={(e) => updateRow(i, "partId", e.target.value)} style={{ flex: 1, minWidth: 160 }}>
              <option value="">Select part…</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.qty} in stock)</option>)}
            </Select>
            <Input type="number" min={1} value={row.qty} onChange={(e) => updateRow(i, "qty", Number(e.target.value))} style={{ width: 70 }} />
            <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer" }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <Btn variant="ghost" size="sm" onClick={addRow} style={{ marginTop: 8 }}><Plus size={13} /> Add part</Btn>

      {isDelivering && (
        <>
          <div style={{ height: 16 }} />
          <Panel style={{ padding: 14, border: `1px solid ${COLORS.teal}55`, background: `${COLORS.tealDim}33` }}>
            <PhotoUploadField label="TV Ready Photo (required to mark Delivered)" value={readyPhoto} onChange={setReadyPhoto} />
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
        <div style={{ marginTop: 8, fontSize: 11.5, color: COLORS.amber }}>Add a "TV Ready" photo before marking this job Delivered.</div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, color: COLORS.faint }}>
        Both buttons save the status, parts, and fault checklist and deduct used parts from inventory — "Save &amp; SMS Update" notifies the customer by SMS, "Save &amp; WhatsApp Update" also opens WhatsApp with the same update.
        The WhatsApp button lets you message the customer immediately without saving these changes yet.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  BILLING (Admin)                                                         */
/* ---------------------------------------------------------------------- */
function Billing({ jobs, invoices, parts, role, onCreateInvoice, onMarkPaid, onPrint, revenueToday, outstandingDues }) {
  const invoiceable = jobs.filter((j) => j.status === "Completed" && !j.invoiced);
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
                <span>{partMap[pu.partId]?.name} x{pu.qty}</span>
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
function TechniciansView({ technicians, setTechnicians, jobs, onRequestDelete }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", specialty: "", type: "indoor" });

  function addTech() {
    if (!f.name.trim()) return;
    setTechnicians((t) => [...t, { id: "T" + (t.length + 1) + Math.floor(Math.random() * 90), ...f }]);
    setF({ name: "", phone: "", specialty: "", type: "indoor" });
    setAdding(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Technicians</div>
        <Btn size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add Technician</Btn>
      </div>

      {adding && (
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px,1fr))", gap: 12 }}>
        {technicians.map((t) => {
          const active = jobs.filter((j) => j.assignedTech === t.id && j.status !== "Delivered").length;
          const done = jobs.filter((j) => j.assignedTech === t.id && j.status === "Delivered").length;
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
                <button
                  onClick={() => onRequestDelete(t)}
                  title="Remove technician"
                  style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", padding: 2, flexShrink: 0 }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.muted, display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}><Phone size={11} /> {t.phone}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 11, background: COLORS.amberDim, color: COLORS.amber, padding: "3px 9px", borderRadius: 999, fontWeight: 700 }}>{active} active</span>
                <span style={{ fontSize: 11, background: COLORS.tealDim, color: COLORS.teal, padding: "3px 9px", borderRadius: 999, fontWeight: 700 }}>{done} delivered</span>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  SMS LOG                                                                  */
/* ---------------------------------------------------------------------- */
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
function PrintChrome({ onBack, children }) {
  return (
    <div style={{ background: "#fff", color: "#111", minHeight: 620, borderRadius: 14, padding: 24, fontFamily: FONT_SANS }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "#EEE", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
          <ArrowLeft size={14} /> Back to CRM
        </button>
        <button onClick={() => smartPrint()} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1A1300", color: "#F0A63A", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          <Printer size={14} /> Print
        </button>
      </div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      {children}
    </div>
  );
}

function PrintLabel({ job, onBack }) {
  return (
    <PrintChrome onBack={onBack}>
      <div className="print-chrome-inner" style={{
        width: 380, maxWidth: "100%", border: "2px solid #111", borderRadius: 10, padding: 18, fontFamily: FONT_MONO, boxSizing: "border-box",
      }}>
        <div style={{ borderBottom: "2px solid #111", paddingBottom: 5, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", lineHeight: 1.2 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>AITECHLAB LED TV SERVICE CENTER</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, lineHeight: 1.15, marginTop: 1 }}>6383647753</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{job.id}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div><strong>Customer:</strong> {job.customer}</div>
          <div><strong>Phone:</strong> {job.phone}</div>
          <div><strong>Device:</strong> {job.brand} {job.model}</div>
          <div><strong>Issue:</strong> {job.issue}</div>
          <div><strong>Accessories:</strong> {job.accessories || "—"}</div>
          <div><strong>Location:</strong> {job.location || "________________"}</div>
          <div><strong>Intake:</strong> {fmtDateTime(job.intake)}</div>
        </div>
        <div style={{ marginTop: 14, borderTop: "1px dashed #111", paddingTop: 8, fontSize: 10, letterSpacing: 1, textAlign: "center" }}>
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
