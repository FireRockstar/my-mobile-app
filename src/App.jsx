import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Tv, LayoutDashboard, ClipboardList, Wrench, Package, Receipt, Users,
  MessageSquare, Plus, Printer, Search, X, Bell, RefreshCw, CheckCircle2,
  Clock, AlertTriangle, LogOut, Phone, ChevronRight, IndianRupee,
  Banknote, CreditCard, Smartphone, Trash2, UserCircle2, ArrowLeft,
  PackagePlus, PackageMinus, TrendingUp, CircleDot, Menu
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
  bg: "#0F1318",
  panel: "#171D25",
  panel2: "#1D2530",
  border: "#2A3441",
  borderLight: "#374253",
  text: "#E8ECF1",
  muted: "#8B97A6",
  faint: "#5C6878",
  amber: "#F0A63A",
  amberDim: "#7A5A26",
  teal: "#2DD4BF",
  tealDim: "#1B4F49",
  red: "#F0554A",
  redDim: "#5C2622",
  blue: "#4FA3F7",
};

const FONT_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
const FONT_SANS = "'Inter', 'Segoe UI', system-ui, sans-serif";

/* ---------------------------------------------------------------------- */
/*  SEED DATA                                                              */
/* ---------------------------------------------------------------------- */
const now = Date.now();
const H = 3600000;

const SEED_TECHS = [
  { id: "T1", name: "Ravi Kumar", phone: "9876500011", specialty: "Panel & Backlight" },
  { id: "T2", name: "Suresh Babu", phone: "9876500022", specialty: "Power & SMPS" },
  { id: "T3", name: "Priya Ganesan", phone: "9876500033", specialty: "Mainboard & T-Con" },
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
    id: "JC-1001", customer: "Anitha Raman", phone: "9843211001",
    brand: "Samsung", model: "UA43T5350", issue: "No display, faint backlight visible",
    accessories: "Remote, power cable", estimate: 2200,
    intake: now - 5.5 * H, status: "Pending", assignedTech: null, partsUsed: [],
    createdBy: "frontdesk",
    updates: [{ ts: now - 5.5 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" }],
    invoiced: false,
  },
  {
    id: "JC-1002", customer: "Mohammed Irfan", phone: "9843211002",
    brand: "LG", model: "43LM6360", issue: "Vertical lines across screen",
    accessories: "None", estimate: 3200,
    intake: now - 3.2 * H, status: "In Progress", assignedTech: "T1", partsUsed: [],
    createdBy: "frontdesk",
    updates: [
      { ts: now - 3.2 * H, by: "Front Desk", note: "Job card created on intake.", status: "Pending" },
      { ts: now - 2.6 * H, by: "Ravi Kumar", note: "Diagnosed T-Con board fault. Ordering part.", status: "In Progress" },
    ],
    invoiced: false,
  },
  {
    id: "JC-1003", customer: "Deepa Selvam", phone: "9843211003",
    brand: "Sony", model: "KLV-32R422", issue: "TV not powering on",
    accessories: "Power cable only", estimate: 1400,
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
    id: "JC-0998", customer: "Karthik Subramaniam", phone: "9843210998",
    brand: "Mi", model: "L50M6-EI", issue: "Cracked panel, physical damage",
    accessories: "Remote", estimate: 5200,
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
  Delivered: { color: COLORS.blue, bg: "#1D3A57", label: "Delivered" },
};

const PAY_ICON = { Cash: Banknote, GPay: Smartphone, "Credit Card": CreditCard };

/* Pending orders surface first everywhere; within a status, the longest-waiting job leads. */
const STATUS_PRIORITY = { Pending: 0, "In Progress": 1, Completed: 2, Delivered: 3 };
const sortByUrgency = (list) =>
  [...list].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.intake - b.intake;
  });

let jobCounter = 1004;
let invCounter = 5002;
const nextJobId = () => `JC-${jobCounter++}`;
const nextInvId = () => `INV-${invCounter++}`;

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
        background: COLORS.panel, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, ...style,
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
  background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 7,
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
        position: "fixed", inset: 0, background: "rgba(6,8,11,0.72)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto",
          background: COLORS.panel, border: `1px solid ${COLORS.borderLight}`, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, position: "sticky", top: 0,
          background: COLORS.panel, borderRadius: "12px 12px 0 0",
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

function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <Panel style={{ padding: 18, flex: 1, minWidth: 190 }}>
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

  const toastTimer = useRef(null);
  const prevOverdueCount = useRef(null);

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

  function pushToast(message, kind = "sms") {
    setToast({ message, kind, id: Math.random() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }

  function sendSms(phone, jobId, message) {
    setSmsLog((l) => [{ ts: Date.now(), phone, jobId, message }, ...l]);
    pushToast(`SMS → ${phone}: ${message}`, "sms");
  }

  const techMap = useMemo(() => Object.fromEntries(technicians.map((t) => [t.id, t])), [technicians]);
  const partMap = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p])), [parts]);

  const overdueJobs = useMemo(
    () => jobs.filter((j) => (j.status === "Pending" || j.status === "In Progress") && Date.now() - j.intake > 2 * H),
    [jobs, tick]
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
  function createJob(data) {
    const id = nextJobId();
    const job = {
      id, ...data, intake: Date.now(), status: "Pending", assignedTech: null,
      partsUsed: [], createdBy: "frontdesk", invoiced: false,
      updates: [{ ts: Date.now(), by: "Front Desk", note: "Job card created on intake.", status: "Pending" }],
    };
    setJobs((j) => [job, ...j]);
    sendSms(data.phone, id, `Hi ${data.customer}, your ${data.brand} ${data.model} has been received. Job ID: ${id}. We'll update you on progress.`);
    return job;
  }

  function assignTech(jobId, techId) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, assignedTech: techId } : j)));
    const job = jobs.find((j) => j.id === jobId);
    const tech = techMap[techId];
    if (job && tech) sendSms(job.phone, jobId, `Hi ${job.customer}, technician ${tech.name} has been assigned to your ${job.brand} ${job.model} repair (${jobId}).`);
  }

  function updateJob(jobId, { status, note, partsUsedDelta, by }) {
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
      sendSms(job.phone, jobId, `Hi ${job.customer}, update on ${jobId}: status is now "${status || job.status}". ${note || ""}${parts_txt}`.trim());
    }
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
        onSelect={(r, techId) => { setRole(r); setActiveTechId(techId || null); setTab(r === "technician" ? "myjobs" : "dashboard"); }}
      />
    );
  }

  const NAV = {
    admin: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
      { id: "inventory", label: "Inventory", icon: Package },
      { id: "technicians", label: "Technicians", icon: Users },
      { id: "sms", label: "SMS Log", icon: MessageSquare },
    ],
    frontdesk: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "newjob", label: "New Job Card", icon: Plus },
      { id: "jobcards", label: "Job Cards", icon: ClipboardList },
      { id: "billing", label: "Billing", icon: Receipt },
      { id: "sms", label: "SMS Log", icon: MessageSquare },
    ],
    technician: [
      { id: "myjobs", label: "My Jobs", icon: Wrench },
    ],
  };

  const roleLabel = { admin: "Admin", frontdesk: "Front Desk", technician: techMap[activeTechId]?.name || "Technician" };
  const roleSub = { admin: "Full access", frontdesk: "Intake desk", technician: techMap[activeTechId]?.specialty || "" };

  return (
    <div className="app-shell" style={{
      fontFamily: FONT_SANS, background: COLORS.bg, color: COLORS.text, minHeight: 620,
      display: "flex", borderRadius: 14, overflow: "hidden", border: `1px solid ${COLORS.border}`,
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
      `}</style>

      {/* ---------------- SIDEBAR ---------------- */}
      <div
        className={`sidebar${mobileNavOpen ? " open" : ""}`}
        style={{ width: 220, background: COLORS.panel, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}
      >
        <div style={{ padding: "18px 18px 14px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Tv size={17} color="#1A1300" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: 0.2 }}>AitechLab CRM</div>
              <div style={{ fontSize: 10, color: COLORS.faint, fontFamily: FONT_MONO, letterSpacing: 0.5 }}>TV REPAIR SERVICE</div>
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
              {n.id === "jobcards" && overdueJobs.length > 0 && role !== "technician" && (
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
            />
          )}

          {tab === "dashboard" && role === "frontdesk" && (
            <FrontDeskDashboard
              jobs={jobs} technicians={technicians} tick={tick}
              onAssign={assignTech} onPrintLabel={setPrintJob}
              onSms={(job) => sendSms(job.phone, job.id, `Hi ${job.customer}, checking in on your ${job.brand} ${job.model} repair. Status: ${job.status}.`)}
            />
          )}

          {tab === "newjob" && (
            <NewJobForm onCreate={(data) => { const j = createJob(data); pushToast(`Job card ${j.id} created for ${j.customer}.`, "ok"); setTab("jobcards"); }} />
          )}

          {tab === "jobcards" && (
            <JobCardsList
              jobs={jobs} technicians={technicians} role={role} tick={tick}
              onPrintLabel={setPrintJob}
              onAssign={assignTech}
              onSms={(job) => sendSms(job.phone, job.id, `Hi ${job.customer}, checking in on your ${job.brand} ${job.model} repair. Status: ${job.status}.`)}
              onRequestDelete={setConfirmDeleteJob}
            />
          )}

          {tab === "myjobs" && (
            <MyJobs
              jobs={jobs.filter((j) => j.assignedTech === activeTechId)}
              parts={parts} tech={techMap[activeTechId]}
              onUpdate={(jobId, payload) => updateJob(jobId, { ...payload, by: techMap[activeTechId]?.name || "Technician" })}
              onPrintLabel={setPrintJob}
              tick={tick}
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

          {tab === "technicians" && <TechniciansView technicians={technicians} setTechnicians={setTechnicians} jobs={jobs} />}

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

      {toast && <Toast toast={toast} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  ROLE SELECT SCREEN                                                     */
/* ---------------------------------------------------------------------- */
function RoleSelect({ technicians, onSelect }) {
  const [pickingTech, setPickingTech] = useState(false);
  return (
    <div style={{
      fontFamily: FONT_SANS, background: `radial-gradient(circle at 30% 20%, #1B222C 0%, ${COLORS.bg} 60%)`,
      color: COLORS.text, minHeight: 620, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: 14, border: `1px solid ${COLORS.border}`, padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Tv size={28} color="#1A1300" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 21 }}>AitechLab CRM</div>
          <div style={{ fontSize: 12, color: COLORS.faint, fontFamily: FONT_MONO, letterSpacing: 1, marginTop: 2 }}>LED TV REPAIR SHOP</div>
        </div>

        {!pickingTech ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { id: "admin", icon: LayoutDashboard, title: "Admin", desc: "Dashboard, billing, inventory, all job cards" },
              { id: "frontdesk", icon: ClipboardList, title: "Front Desk", desc: "Intake, job cards, print labels, SMS" },
              { id: "technician", icon: Wrench, title: "Technician", desc: "Update progress, log spare parts used" },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => (r.id === "technician" ? setPickingTech(true) : onSelect(r.id))}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "16px 16px", borderRadius: 11,
                  background: COLORS.panel, border: `1px solid ${COLORS.border}`, cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = COLORS.amber)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = COLORS.border)}
              >
                <div style={{ width: 40, height: 40, borderRadius: 9, background: COLORS.panel2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <r.icon size={19} color={COLORS.amber} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 1 }}>{r.desc}</div>
                </div>
                <ChevronRight size={17} color={COLORS.faint} />
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button onClick={() => setPickingTech(false)} style={{ background: "none", border: "none", color: COLORS.muted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 14, fontSize: 12.5 }}>
              <ArrowLeft size={14} /> Back
            </button>
            <div style={{ fontSize: 12, color: COLORS.faint, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Select technician</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {technicians.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelect("technician", t.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 10,
                    background: COLORS.panel, border: `1px solid ${COLORS.border}`, cursor: "pointer", textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = COLORS.teal)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = COLORS.border)}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700, fontSize: 13 }}>
                    {t.name.split(" ").map((x) => x[0]).join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>{t.specialty}</div>
                  </div>
                  <ChevronRight size={16} color={COLORS.faint} />
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
function TopBar({ role, overdueCount, lastRefresh, tick, showAlerts, setShowAlerts, overdueJobs, onManualRefresh, onOpenNav }) {
  const titles = { admin: "Dashboard", frontdesk: "Front Desk", technician: "Technician Bench" };
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panel, gap: 10, flexWrap: "wrap",
    }}>
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
          <Bell size={15} color={overdueCount ? COLORS.amber : COLORS.faint} />
          {overdueCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4, background: COLORS.red, color: "#fff",
              fontSize: 9.5, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_MONO, padding: "0 3px",
            }}>
              {overdueCount}
            </span>
          )}
        </button>
        {showAlerts && (
          <div style={{
            position: "absolute", top: 42, right: 0, width: "min(300px, 88vw)", background: COLORS.panel2,
            border: `1px solid ${COLORS.borderLight}`, borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            zIndex: 40, padding: 12,
          }}>
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
/*  TOAST                                                                   */
/* ---------------------------------------------------------------------- */
function Toast({ toast }) {
  const kindColor = toast.kind === "alert" ? COLORS.amber : toast.kind === "ok" ? COLORS.teal : COLORS.blue;
  const Icon = toast.kind === "alert" ? AlertTriangle : toast.kind === "ok" ? CheckCircle2 : MessageSquare;
  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, left: 20, maxWidth: 360, marginLeft: "auto", background: COLORS.panel2,
      border: `1px solid ${kindColor}55`, borderRadius: 10, padding: "12px 14px", display: "flex", gap: 10,
      boxShadow: "0 10px 30px rgba(0,0,0,0.45)", zIndex: 200, alignItems: "flex-start",
    }}>
      <Icon size={16} color={kindColor} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>{toast.message}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  DASHBOARD (Admin)                                                       */
/* ---------------------------------------------------------------------- */
function Dashboard({ jobs, invoices, technicians, parts, revenueToday, outstandingDues, pendingOrders, overdueJobs, tick }) {
  const lowStock = parts.filter((p) => p.qty <= p.low);
  const workload = technicians.map((t) => ({
    ...t,
    active: jobs.filter((j) => j.assignedTech === t.id && (j.status === "Pending" || j.status === "In Progress")).length,
    completed: jobs.filter((j) => j.assignedTech === t.id && (j.status === "Completed" || j.status === "Delivered")).length,
  }));
  const maxActive = Math.max(1, ...workload.map((w) => w.active));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pendingOrders.length} sub="Awaiting or in repair" accent={COLORS.amber} />
        <StatCard icon={IndianRupee} label="Revenue Today" value={fmtMoney(revenueToday)} sub="Paid invoices, today" accent={COLORS.teal} />
        <StatCard icon={AlertTriangle} label="Outstanding Dues" value={fmtMoney(outstandingDues)} sub="Unpaid invoices" accent={COLORS.red} />
        <StatCard icon={Clock} label="Overdue (>2h)" value={overdueJobs.length} sub="Need attention now" accent={COLORS.red} />
      </div>

      {overdueJobs.length > 0 && (
        <Panel style={{ padding: 16, border: `1px solid ${COLORS.red}55`, background: `${COLORS.redDim}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={16} color={COLORS.red} />
            <span style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.text }}>Orders sitting {'>'} 2 hours without progress</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 8 }}>
            {overdueJobs.map((j) => (
              <div key={j.id} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "9px 11px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, fontWeight: 700 }}>
                  <span>{j.id}</span><Badge status={j.status} />
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{j.customer} — {j.brand} {j.model}</div>
                <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 2 }}>{timeAgo(j.intake, tick)}</div>
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
            <div key={j.id} className="rowhover data-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${COLORS.border}` }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, width: 78 }}>{j.id}</span>
              <span style={{ fontSize: 12.5, flex: 1 }}>{j.customer} — {j.brand} {j.model}</span>
              <span style={{ fontSize: 11.5, color: COLORS.faint, width: 130 }}>{j.assignedTech ? techMapName(technicians, j.assignedTech) : "Unassigned"}</span>
              <span style={{ fontSize: 11, color: COLORS.faint, width: 90 }}>{timeAgo(j.intake, tick)}</span>
              <Badge status={j.status} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
function techMapName(technicians, id) { return technicians.find((t) => t.id === id)?.name || "—"; }

/* ---------------------------------------------------------------------- */
/*  FRONT DESK DASHBOARD                                                    */
/*  Today's pending orders lead the page; completed orders sit below.       */
/* ---------------------------------------------------------------------- */
function FrontDeskDashboard({ jobs, technicians, tick, onAssign, onPrintLabel, onSms }) {
  const pending = sortByUrgency(jobs.filter((j) => j.status === "Pending" || j.status === "In Progress"));
  const pendingToday = pending.filter((j) => isSameDay(j.intake));
  const unassigned = pending.filter((j) => !j.assignedTech);
  const completed = jobs
    .filter((j) => j.status === "Completed" || j.status === "Delivered")
    .sort((a, b) => (b.updates[b.updates.length - 1]?.ts || 0) - (a.updates[a.updates.length - 1]?.ts || 0));
  const completedToday = completed.filter((j) => isSameDay(j.updates[j.updates.length - 1]?.ts || 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="stat-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <StatCard icon={ClipboardList} label="Pending Orders" value={pending.length} sub="Open across the bench" accent={COLORS.amber} />
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
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 12.5, width: 78 }}>{j.id}</span>
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
                <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /></Btn>
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
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLORS.text, width: 78 }}>{j.id}</span>
              <span style={{ fontSize: 12.5, flex: 1 }}>{j.customer} — {j.brand} {j.model}</span>
              <span style={{ fontSize: 11.5, color: COLORS.faint, width: 130 }}>{j.assignedTech ? techMapName(technicians, j.assignedTech) : "Unassigned"}</span>
              <span style={{ fontSize: 11, color: COLORS.faint, width: 110 }}>{timeAgo(j.updates[j.updates.length - 1]?.ts || j.intake, tick)}</span>
              <Badge status={j.status} />
              <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /></Btn>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  NEW JOB FORM (Front Desk)                                              */
/* ---------------------------------------------------------------------- */
function NewJobForm({ onCreate }) {
  const [f, setF] = useState({ customer: "", phone: "", brand: "", model: "", issue: "", accessories: "", estimate: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.customer.trim() && f.phone.trim().length >= 10 && f.brand.trim() && f.model.trim() && f.issue.trim();

  return (
    <Panel style={{ padding: 22, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
        <Plus size={17} color={COLORS.amber} />
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>New Job Card — Intake</div>
      </div>
      <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Customer Name"><Input value={f.customer} onChange={set("customer")} placeholder="e.g. Anitha Raman" /></Field>
        <Field label="Phone Number"><Input value={f.phone} onChange={set("phone")} placeholder="10-digit mobile" /></Field>
        <Field label="TV Brand"><Input value={f.brand} onChange={set("brand")} placeholder="e.g. Samsung, LG, Sony" /></Field>
        <Field label="Model Number"><Input value={f.model} onChange={set("model")} placeholder="e.g. UA43T5350" /></Field>
        <Field label="Accessories Brought"><Input value={f.accessories} onChange={set("accessories")} placeholder="Remote, cable, stand…" /></Field>
        <Field label="Estimated Cost (₹)"><Input type="number" value={f.estimate} onChange={set("estimate")} placeholder="Optional" /></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Reported Issue"><TextArea value={f.issue} onChange={set("issue")} placeholder="Describe the fault as reported by customer…" /></Field>
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn
          disabled={!valid}
          onClick={() => { onCreate({ ...f, estimate: Number(f.estimate) || 0 }); setF({ customer: "", phone: "", brand: "", model: "", issue: "", accessories: "", estimate: "" }); }}
        >
          <Plus size={14} /> Create Job Card &amp; Send SMS
        </Btn>
        <Btn variant="outline" onClick={() => setF({ customer: "", phone: "", brand: "", model: "", issue: "", accessories: "", estimate: "" })}>Clear</Btn>
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.faint }}>
        Creating a job card automatically sends an SMS confirmation to the customer with their Job ID.
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- */
/*  JOB CARDS LIST (Admin + Front Desk)                                    */
/* ---------------------------------------------------------------------- */
function JobCardsList({ jobs, technicians, role, tick, onPrintLabel, onAssign, onSms, onRequestDelete }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null);

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
          const overdue = (j.status === "Pending" || j.status === "In Progress") && Date.now() - j.intake > 2 * H;
          return (
            <Panel key={j.id} style={{ padding: 15, borderColor: overdue ? `${COLORS.red}66` : COLORS.border }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{j.id}</span>
                    <Badge status={j.status} />
                    {overdue && <span style={{ fontSize: 10.5, color: COLORS.red, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={11} /> overdue</span>}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{j.customer} <span style={{ color: COLORS.faint, fontWeight: 400 }}>· {j.phone}</span></div>
                  <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{j.brand} {j.model} — {j.issue}</div>
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
                  <Btn size="sm" variant="outline" onClick={() => onSms(j)}><MessageSquare size={13} /> SMS</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setDetail(j)}>Details</Btn>
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
          <JobDetail job={detail} technicians={technicians} />
        </Modal>
      )}
    </div>
  );
}

function JobDetail({ job, technicians }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16, fontSize: 12.5 }} className="form-grid-2col">
        <div><span style={{ color: COLORS.faint }}>Customer:</span> {job.customer}</div>
        <div><span style={{ color: COLORS.faint }}>Phone:</span> {job.phone}</div>
        <div><span style={{ color: COLORS.faint }}>Device:</span> {job.brand} {job.model}</div>
        <div><span style={{ color: COLORS.faint }}>Technician:</span> {technicians.find((t) => t.id === job.assignedTech)?.name || "Unassigned"}</div>
        <div style={{ gridColumn: "1 / -1" }}><span style={{ color: COLORS.faint }}>Issue:</span> {job.issue}</div>
        {job.partsUsed.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: COLORS.faint }}>Parts used:</span> {job.partsUsed.map((p) => `${p.partId} x${p.qty}`).join(", ")}
          </div>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: COLORS.faint }}>Update Timeline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  MY JOBS (Technician)                                                    */
/* ---------------------------------------------------------------------- */
function MyJobs({ jobs, parts, tech, onUpdate, onPrintLabel, tick }) {
  const [editing, setEditing] = useState(null);
  const active = jobs.filter((j) => j.status !== "Delivered");
  const done = jobs.filter((j) => j.status === "Delivered");

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: COLORS.muted }}>
        Logged in as <strong style={{ color: COLORS.text }}>{tech?.name}</strong> · {active.length} active job{active.length === 1 ? "" : "s"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.length === 0 && <div style={{ color: COLORS.faint, fontSize: 13 }}>No jobs assigned to you right now.</div>}
        {sortByUrgency(active).map((j) => {
          const overdue = (j.status === "Pending" || j.status === "In Progress") && Date.now() - j.intake > 2 * H;
          return (
            <Panel key={j.id} style={{ padding: 15, borderColor: overdue ? `${COLORS.red}66` : COLORS.border }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13.5 }}>{j.id}</span>
                    <Badge status={j.status} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{j.customer} <span style={{ color: COLORS.faint, fontWeight: 400 }}>· {j.phone}</span></div>
                  <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{j.brand} {j.model} — {j.issue}</div>
                  <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 4 }}>Intake {timeAgo(j.intake, tick)}</div>
                </div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <Btn size="sm" variant="outline" onClick={() => onPrintLabel(j)}><Printer size={13} /> Label</Btn>
                  <Btn size="sm" onClick={() => setEditing(j)}><Wrench size={13} /> Update</Btn>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {done.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12.5, color: COLORS.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Delivered</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {done.map((j) => (
              <div key={j.id} className="data-row" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "8px 4px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.muted }}>
                <span style={{ fontFamily: FONT_MONO }}>{j.id}</span><span>{j.customer}</span><Badge status={j.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <Modal title={`Update ${editing.id}`} onClose={() => setEditing(null)}>
          <UpdateJobForm
            job={editing} parts={parts}
            onSave={(payload) => { onUpdate(editing.id, payload); setEditing(null); }}
          />
        </Modal>
      )}
    </div>
  );
}

function UpdateJobForm({ job, parts, onSave }) {
  const [status, setStatus] = useState(job.status);
  const [note, setNote] = useState("");
  const [partRows, setPartRows] = useState([{ partId: "", qty: 1 }]);

  const addRow = () => setPartRows((r) => [...r, { partId: "", qty: 1 }]);
  const removeRow = (i) => setPartRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i, field, val) => setPartRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  const validRows = partRows.filter((r) => r.partId && r.qty > 0);

  return (
    <div>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["Pending", "In Progress", "Completed", "Delivered"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
      <div style={{ height: 12 }} />
      <Field label="Progress Note (sent to customer via SMS)">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Diagnosed T-Con board fault, replacing now…" />
      </Field>
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

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <Btn onClick={() => onSave({ status, note: note || `Status updated to ${status}.`, partsUsedDelta: validRows })}>
          <CheckCircle2 size={14} /> Save &amp; Notify Customer
        </Btn>
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, color: COLORS.faint }}>
        Saving sends an SMS update to the customer and deducts used parts from inventory.
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
  const isAdmin = role === "admin";

  return (
    <div>
      <div className="stat-row" style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        {isAdmin && (
          <StatCard icon={IndianRupee} label="Revenue Today" value={fmtMoney(revenueToday)} accent={COLORS.teal} />
        )}
        <StatCard icon={AlertTriangle} label="Outstanding Dues" value={fmtMoney(outstandingDues)} accent={COLORS.red} />
        <StatCard icon={Receipt} label="Invoices Issued" value={invoices.length} accent={COLORS.amber} />
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

      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>All Invoices</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {invoices.map((inv) => {
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

      {billingJob && (
        <Modal title={`Generate Invoice — ${billingJob.id}`} onClose={() => setBillingJob(null)}>
          <InvoiceForm
            job={billingJob} parts={parts}
            onSubmit={(labor, method, status) => { onCreateInvoice(billingJob, labor, method, status); setBillingJob(null); }}
          />
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
function TechniciansView({ technicians, setTechnicians, jobs }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", specialty: "" });

  function addTech() {
    if (!f.name.trim()) return;
    setTechnicians((t) => [...t, { id: "T" + (t.length + 1) + Math.floor(Math.random() * 90), ...f }]);
    setF({ name: "", phone: "", specialty: "" });
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
          <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Specialty"><Input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></Field>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 999, background: COLORS.tealDim, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.teal, fontWeight: 700 }}>
                  {t.name.split(" ").map((x) => x[0]).join("")}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.faint }}>{t.specialty}</div>
                </div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #111", paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>AITECHLAB CRM · TV REPAIR</div>
          <div style={{ fontSize: 11 }}>JOB LABEL</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, marginBottom: 10 }}>{job.id}</div>
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div><strong>Customer:</strong> {job.customer}</div>
          <div><strong>Phone:</strong> {job.phone}</div>
          <div><strong>Device:</strong> {job.brand} {job.model}</div>
          <div><strong>Issue:</strong> {job.issue}</div>
          <div><strong>Accessories:</strong> {job.accessories || "—"}</div>
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
