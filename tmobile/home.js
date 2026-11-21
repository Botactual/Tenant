import {
  auth, unitOf, listLeases, listPayments, listMaintenance, listMaintenanceAttachments,
  createMaintenanceRequest, addMaintenanceAttachments, uploadMaintenanceFile,
  MAX_ATTACH_BYTES, MAX_ATTACH_FILES,
} from "../shared/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// ---------- Setup ----------
const DUE_DAY = 5;        // rent is due on this day of the month (same as the dashboard's Payment page)
const SOON_DAYS = 60;     // show a "lease ending" notice this many days ahead
const READ_KEY = "tenere.tenant.read";
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const THIS_MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const TODAY = `${THIS_MONTH}-${pad(now.getDate())}`;
const MONTH_LABEL = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;

const peso = (n) => "₱" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
const fmtLong = (iso) => new Date(String(iso).slice(0, 10) + "T00:00:00Z")
  .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtShort = (iso) => {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  if (d.getUTCFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
};
const fmtSize = (bytes) => bytes < 1024 * 1024
  ? Math.max(1, Math.round(bytes / 1024)) + " KB"
  : (bytes / (1024 * 1024)).toFixed(1) + " MB";
const daysUntil = (iso) => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(TODAY)) / 86400000);

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  receipt: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  clip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
};

const FOLDERS = {
  inbox:       { title: "Inbox",           match: () => true },
  rent:        { title: "Rent & invoices", match: (i) => i.type === "rent" || i.type === "payment" },
  maintenance: { title: "Maintenance",     match: (i) => i.type === "maintenance" },
  notices:     { title: "Notices",         match: (i) => i.type === "notice" },
};

const STEPS = ["Sent", "In progress", "Resolved"];
const statusKey = (s) => {
  s = String(s || "").toLowerCase();
  if (/^(done|resolved|closed|completed)$/.test(s)) return "done";
  if (/progress|ongoing|working/.test(s)) return "progress";
  return "open";
};
const STATUS_TAG = {
  open:     { text: "Open",        cls: "warn" },
  progress: { text: "In progress", cls: "info" },
  done:     { text: "Resolved",    cls: "ok" },
};

// Only real https links are ever used for photos/videos
const safeUrl = (u) => (/^https:\/\//i.test(u || "") ? u : "");

// ---------- State ----------
let user = null;
let me = null;            // the signed-in tenant's lease: { id, propertyId, unit, name, email, address, rent, startISO, endISO }
let items = [];           // everything shown in the inbox
let loadError = "";
let loaded = false;       // true once the first load has finished
let lastLoad = 0;
let readIds = new Set();
let readKey = READ_KEY;
const state = { folder: "inbox", query: "" };

const isUnread = (it) => !readIds.has(it.id);
function markRead(it) {
  if (readIds.has(it.id)) return;
  readIds.add(it.id);
  try { localStorage.setItem(readKey, JSON.stringify([...readIds])); } catch { /* storage blocked */ }
}

// ---------- Build the inbox from the database ----------
function buildItems(payments, requests, mediaByRequest) {
  const out = [];
  const l = me;

  // 1) Rent for this month
  const paidNow = payments.find((p) => p.paid && p.date.startsWith(THIS_MONTH));
  const dueISO = `${THIS_MONTH}-${pad(DUE_DAY)}`;
  const overdue = !paidNow && TODAY > dueISO;
  const rentTag = paidNow ? { text: "Paid", cls: "ok" }
                : overdue ? { text: "Overdue", cls: "bad" }
                :           { text: "Due", cls: "warn" };
  out.push({
    id: `rent-${THIS_MONTH}`,
    type: "rent",
    cls: paidNow ? "t-ok" : overdue ? "t-bad" : "t-warn",
    icon: ICON.receipt,
    from: "Rent & Billing",
    subject: `Rent for ${MONTH_LABEL}`,
    preview: paidNow ? `Paid ${peso(paidNow.amount)}. Thank you!`
           : overdue ? `${peso(l.rent)} was due ${fmtShort(dueISO)}. Please pay your landlord.`
           :           `${peso(l.rent)} is due ${fmtShort(dueISO)}.`,
    time: fmtShort(paidNow ? paidNow.date : dueISO),
    sort: paidNow ? paidNow.date : dueISO,
    pin: paidNow ? 0 : 1,
    tag: rentTag,
    body: paidNow ? `Your rent for ${MONTH_LABEL} has been paid. Thank you!`
        : overdue ? `Your rent for ${MONTH_LABEL} (${peso(l.rent)}) was due on ${fmtLong(dueISO)}. Please settle it with your landlord and keep your payment reference.`
        :           `Your rent for ${MONTH_LABEL} (${peso(l.rent)}) is due on ${fmtLong(dueISO)}.`,
    rows: [
      ["Amount", peso(l.rent)],
      ["Due date", fmtLong(dueISO)],
      ["Status", rentTag.text],
      ["Unit", l.unit],
      ["Lease term", `${fmtLong(l.startISO)} → ${fmtLong(l.endISO)}`],
    ],
  });

  // 2) Payments received
  payments.forEach((p) => {
    out.push({
      id: `pay-${p.id}`,
      type: "payment",
      cls: p.paid ? "t-ok" : "t-warn",
      icon: ICON.check,
      from: "Rent & Billing",
      subject: p.paid ? "Payment received" : `Payment ${String(p.status).toLowerCase()}`,
      preview: `${peso(p.amount)}${p.method ? " via " + p.method : ""}${p.ref ? " · Ref " + p.ref : ""}`,
      time: fmtShort(p.date),
      sort: p.date,
      pin: 0,
      tag: null,
      body: p.paid ? `We received your payment of ${peso(p.amount)} on ${fmtLong(p.date)}.`
                   : `Your payment of ${peso(p.amount)} on ${fmtLong(p.date)} is ${String(p.status).toLowerCase()}.`,
      rows: [
        ["Amount", peso(p.amount)],
        ["Date", fmtLong(p.date)],
        ["Method", p.method || "—"],
        ["Reference", p.ref || "—"],
        ["Status", cap(p.status)],
      ],
    });
  });

  // 3) Maintenance requests for this unit
  requests.forEach((r) => {
    const key = statusKey(r.status);
    const tag = STATUS_TAG[key];
    const resolved = r.resolutionDate ? String(r.resolutionDate).slice(0, 10) : "";
    const rows = [["Status", tag.text]];
    if (r.priorityLevel) rows.push(["Priority", cap(r.priorityLevel)]);
    if (resolved) rows.push(["Resolved", fmtLong(resolved)]);
    rows.push(["Unit", l.unit]);
    out.push({
      id: `mr-${r.id}-${key}`,          // a status change makes it unread again
      type: "maintenance",
      cls: "t-" + tag.cls,
      icon: ICON.wrench,
      from: "Maintenance",
      subject: r.title,
      preview: r.description || "",
      time: key === "done" && resolved ? fmtShort(resolved) : "",
      sort: key === "done" ? (resolved || "0000-00-00") : TODAY,
      pin: key === "done" ? 0 : 1,
      tag,
      body: r.description || "",
      rows,
      step: key === "done" ? 2 : key === "progress" ? 1 : 0,
      media: mediaByRequest.get(r.id) || [],   // photos and videos sent with the request
    });
  });

  // 4) Lease ending soon
  const left = daysUntil(l.endISO);
  if (left >= 0 && left <= SOON_DAYS) {
    out.push({
      id: `lease-end-${l.id}`,
      type: "notice",
      cls: "t-info",
      icon: ICON.bell,
      from: "Lease",
      subject: `Your lease ends on ${fmtLong(l.endISO)}`,
      preview: left === 0 ? "Your lease ends today." : `${left} day${left === 1 ? "" : "s"} left. Talk to your landlord about renewing.`,
      time: fmtShort(l.endISO),
      sort: TODAY,
      pin: 1,
      tag: null,
      body: `Your lease for Unit ${l.unit} ends on ${fmtLong(l.endISO)}${left === 0 ? " (today)" : ` (${left} day${left === 1 ? "" : "s"} from now)`}. If you'd like to renew or move out, please let your landlord know.`,
      rows: [
        ["Unit", l.unit],
        ["Lease ends", fmtLong(l.endISO)],
        ["Monthly rent", peso(l.rent)],
      ],
    });
  }

  out.sort((a, b) => (b.pin - a.pin) || String(b.sort).localeCompare(String(a.sort)));
  return out;
}

// ---------- Rendering ----------
function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return items
    .filter(FOLDERS[state.folder].match)
    .filter((i) => !q || [i.from, i.subject, i.preview].join(" ").toLowerCase().includes(q));
}

function rowEl(it) {
  const li = document.createElement("li");
  li.className = "mail-row" + (isUnread(it) ? " unread" : "");
  li.tabIndex = 0;
  li.dataset.id = it.id;
  li.innerHTML = `
    <span class="avatar-icon ${it.cls}">${it.icon}</span>
    <div class="mail-main">
      <div class="mail-from"></div>
      <div class="mail-subject"></div>
      <div class="mail-preview"></div>
    </div>
    <div class="mail-side"><span class="mail-time"></span></div>`;
  // textContent everywhere so request text can never inject HTML
  li.querySelector(".mail-from").textContent = it.from;
  li.querySelector(".mail-subject").textContent = it.subject;
  li.querySelector(".mail-preview").textContent = it.preview;
  li.querySelector(".mail-time").textContent = it.time;
  if (it.media && it.media.length) {
    const clip = document.createElement("span");
    clip.className = "mail-clip";
    clip.innerHTML = ICON.clip;
    li.querySelector(".mail-side").appendChild(clip);
  }
  if (it.tag) {
    const t = document.createElement("span");
    t.className = "tag " + it.tag.cls;
    t.textContent = it.tag.text;
    li.querySelector(".mail-side").appendChild(t);
  }
  return li;
}

function renderList() {
  const shown = visibleItems();
  const list = $("mail-list");
  list.innerHTML = "";
  shown.forEach((it) => list.appendChild(rowEl(it)));

  const empty = $("empty");
  if (loadError) empty.textContent = loadError;
  else if (!loaded) empty.textContent = "Loading…";
  else if (!me) empty.textContent = `Your account (${user.email}) isn't linked to a unit yet. Ask your landlord to add this email to your tenant record, then tap refresh.`;
  else if (state.query.trim()) empty.textContent = "No messages match your search.";
  else empty.textContent = "Nothing here yet.";
  empty.hidden = shown.length !== 0;
}

function renderCounts() {
  Object.keys(FOLDERS).forEach((f) => {
    const n = items.filter(FOLDERS[f].match).filter(isUnread).length;
    const el = document.querySelector(`[data-count="${f}"]`);
    el.textContent = n ? n : "";
  });
}

function renderAccount() {
  const name = me ? me.name : (user.email || "Tenant");
  const letter = (me ? me.name : user.email || "T").trim().charAt(0).toUpperCase();
  $("avatar-letter").textContent = letter;
  $("menu-avatar").textContent = letter;
  $("menu-name").textContent = name;
  $("menu-email").textContent = user.email || "";
  $("menu-unit").textContent = me ? `Unit ${me.unit}${me.address ? " · " + me.address : ""}` : "No unit linked yet";
  $("drawer-unit").textContent = me ? `Unit ${me.unit}` : "";
  $("compose-unit").textContent = me ? `Unit ${me.unit}` : "";
  $("compose-btn").hidden = !me;
}

function renderAll() {
  $("folder-title").textContent = FOLDERS[state.folder].title;
  document.querySelectorAll("[data-folder]").forEach((b) =>
    b.classList.toggle("active", b.dataset.folder === state.folder));
  renderAccount();
  renderCounts();
  renderList();
}

// ---------- Load ----------
// NOTE: these shared queries return every tenant's rows; the page keeps only the signed-in
// tenant's own. Tighten the database rules before real tenants use this.
async function loadData() {
  lastLoad = Date.now();
  try {
    const [rawLeases, rawPayments, rawRequests] = await Promise.all([listLeases(), listPayments(), listMaintenance()]);
    // Attachments are optional: the inbox still loads if that query isn't deployed yet
    const rawMedia = await listMaintenanceAttachments().catch((err) => {
      console.warn("Could not load attachments:", err);
      return [];
    });
    const email = (user.email || "").trim().toLowerCase();
    const mine = rawLeases.find((l) => !l.tenant.isArchived && (l.tenant.email || "").trim().toLowerCase() === email);

    if (!mine) {
      me = null;
      items = [];
    } else {
      me = {
        id: mine.id,
        propertyId: mine.property.id,
        unit: unitOf(mine),
        name: `${mine.tenant.firstName} ${mine.tenant.lastName}`,
        address: mine.property.address || "",
        rent: Number(mine.monthlyRent),
        startISO: String(mine.startDate).slice(0, 10),
        endISO: String(mine.endDate).slice(0, 10),
      };
      const payments = rawPayments
        .filter((p) => p.lease && p.lease.id === mine.id)
        .map((p) => ({
          id: p.id,
          date: String(p.paymentDate).slice(0, 10),
          amount: p.amount != null ? Number(p.amount) : me.rent,
          method: p.paymentMethod || "",
          ref: p.transactionReference || "",
          status: p.status,
          paid: String(p.status).toLowerCase() === "paid",
        }));
      const requests = rawRequests.filter((r) => r.property && r.property.id === mine.property.id);

      // request id -> its photos and videos
      const mediaByRequest = new Map();
      rawMedia.forEach((a) => {
        const id = a.request && a.request.id;
        if (!id) return;
        if (!mediaByRequest.has(id)) mediaByRequest.set(id, []);
        mediaByRequest.get(id).push({ name: a.fileName, url: a.fileUrl, type: a.contentType });
      });

      items = buildItems(payments, requests, mediaByRequest);
    }
    loadError = "";
  } catch (err) {
    console.error(err);
    loadError = "Could not load your inbox: " + (err.message || err);
  }
  loaded = true;
  renderAll();
}

// ---------- Open a message (detail view) ----------
const listView = $("list-view");
const detailView = $("detail-view");

function showDetail(on) {
  listView.hidden = on;
  detailView.hidden = !on;
  if (on) window.scrollTo(0, 0);
}

// One photo (tap to open full size) or video (with controls)
function mediaNode(m) {
  const url = safeUrl(m.url);
  if (!url) return null;
  if (/^video\//i.test(m.type || "")) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    return v;
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  const img = document.createElement("img");
  img.src = url;
  img.alt = m.name || "Photo";
  img.loading = "lazy";
  a.appendChild(img);
  return a;
}

function openItem(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  markRead(it);

  $("d-subject").textContent = it.subject;
  $("d-avatar").className = "avatar-icon " + it.cls;
  $("d-avatar").innerHTML = it.icon;
  $("d-from").textContent = it.from;
  $("d-time").textContent = it.time;
  $("d-body").textContent = it.body;

  const mediaBox = $("d-media");
  mediaBox.innerHTML = "";
  (it.media || []).forEach((m) => {
    const node = mediaNode(m);
    if (node) mediaBox.appendChild(node);
  });
  mediaBox.hidden = !mediaBox.children.length;

  const tag = $("d-tag");
  tag.hidden = !it.tag;
  if (it.tag) { tag.className = "tag " + it.tag.cls; tag.textContent = it.tag.text; }

  const steps = $("d-steps");
  steps.innerHTML = "";
  steps.hidden = it.step == null;
  if (it.step != null) {
    STEPS.forEach((label, i) => {
      const s = document.createElement("div");
      s.className = "step" + (i <= it.step ? " done" : "") + (i === it.step ? " current" : "");
      s.textContent = label;
      steps.appendChild(s);
    });
  }

  const rows = $("d-rows");
  rows.innerHTML = "";
  it.rows.forEach(([k, v]) => {
    const r = document.createElement("div");
    r.className = "d-row";
    const a = document.createElement("span");
    const b = document.createElement("span");
    a.textContent = k;
    b.textContent = v;
    r.append(a, b);
    rows.appendChild(r);
  });

  showDetail(true);
  history.pushState({ v: "detail" }, "");   // so the phone's Back button returns to the list
  renderCounts();
}

$("mail-list").addEventListener("click", (e) => {
  const row = e.target.closest(".mail-row");
  if (row) openItem(row.dataset.id);
});
$("mail-list").addEventListener("keydown", (e) => {
  const row = e.target.closest(".mail-row");
  if (row && e.key === "Enter") openItem(row.dataset.id);
});

$("back-btn").addEventListener("click", () => history.back());

// ---------- Search + folders + drawer ----------
$("search").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderList();
});

const drawer = $("drawer");
const scrim = $("scrim");
function setDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  scrim.hidden = !open;
}
$("menu-btn").addEventListener("click", () => setDrawer(true));
scrim.addEventListener("click", () => setDrawer(false));

document.querySelectorAll("[data-folder]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.folder = btn.dataset.folder;
    setDrawer(false);
    renderAll();
    window.scrollTo(0, 0);
  });
});

$("refresh-btn").addEventListener("click", () => { toast("Refreshing…"); loadData(); });

// ---------- Account menu ----------
const accountMenu = $("account-menu");
$("avatar-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  accountMenu.hidden = !accountMenu.hidden;
});
accountMenu.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { accountMenu.hidden = true; });

$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});

// ---------- Compose (new maintenance request) ----------
const sheet = $("compose-sheet");
const form = $("compose-form");
const formError = $("compose-error");
const sendBtn = $("send-btn");
const attachInput = $("attach-input");

let picked = [];        // the photos/videos chosen for this request (File objects)
let previewUrls = [];   // temporary preview links, released when the list is redrawn

function showFormError(msg) { formError.textContent = msg; }
function closeSheet() { sheet.hidden = true; }
function setSending(text) { $("send-label").textContent = text; }

// Draws the chosen files under the Attach button, each with a small preview and a remove button
function renderPicked() {
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
  const list = $("attach-list");
  list.innerHTML = "";

  picked.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    previewUrls.push(url);
    const isVideo = f.type.startsWith("video/");

    const li = document.createElement("li");
    li.className = "attach-item";

    const thumb = document.createElement(isVideo ? "video" : "img");
    thumb.className = "attach-thumb";
    if (isVideo) {
      thumb.src = url + "#t=0.1";       // shows the first frame
      thumb.muted = true;
      thumb.playsInline = true;
      thumb.preload = "metadata";
    } else {
      thumb.src = url;
      thumb.alt = "";
    }

    const meta = document.createElement("div");
    meta.className = "attach-meta";
    const name = document.createElement("div");
    name.className = "attach-name";
    name.textContent = f.name;
    const size = document.createElement("div");
    size.className = "attach-size";
    size.textContent = (isVideo ? "Video · " : "Photo · ") + fmtSize(f.size);
    meta.append(name, size);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "icon-btn small attach-remove";
    rm.setAttribute("aria-label", "Remove " + f.name);
    rm.innerHTML = ICON.close;
    rm.addEventListener("click", () => {
      picked.splice(i, 1);
      renderPicked();
      showFormError("");
    });

    li.append(thumb, meta, rm);
    list.appendChild(li);
  });
}

$("attach-btn").addEventListener("click", () => attachInput.click());

attachInput.addEventListener("change", () => {
  const files = [...attachInput.files];
  attachInput.value = "";               // so the same file can be picked again later
  let error = "";
  files.forEach((f) => {
    if (!/^(image|video)\//.test(f.type)) { error = `${f.name} is not a photo or video.`; return; }
    if (f.size > MAX_ATTACH_BYTES) { error = `${f.name} is larger than ${MAX_ATTACH_BYTES / (1024 * 1024)} MB.`; return; }
    if (picked.length >= MAX_ATTACH_FILES) { error = `You can attach up to ${MAX_ATTACH_FILES} files.`; return; }
    picked.push(f);
  });
  renderPicked();
  showFormError(error);
});

$("compose-btn").addEventListener("click", () => {
  form.reset();
  picked = [];
  renderPicked();
  showFormError("");
  sheet.hidden = false;
  history.pushState({ v: "sheet" }, "");
  form.elements.title.focus();
});
$("compose-close").addEventListener("click", () => history.back());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me) return;
  const d = Object.fromEntries(new FormData(form));
  const title = (d.title || "").trim();
  const description = (d.description || "").trim();
  if (!title) return showFormError("Add a short subject.");
  if (!description) return showFormError("Describe the problem so your landlord knows what to fix.");

  sendBtn.disabled = true;
  $("compose-close").disabled = true;
  showFormError("");
  let attachFailed = false;
  try {
    // 1) Upload the photos/videos first, so nothing is sent if an upload fails
    const uploaded = [];
    for (let i = 0; i < picked.length; i++) {
      const n = picked.length;
      setSending(`Uploading ${i + 1}/${n}…`);
      uploaded.push(await uploadMaintenanceFile(picked[i], me.propertyId,
        (p) => setSending(`Uploading ${i + 1}/${n} · ${Math.round(p * 100)}%`)));
    }

    // 2) Send the request itself
    setSending("Sending…");
    const requestId = await createMaintenanceRequest({ title, description, priorityLevel: d.priority, propertyId: me.propertyId });

    // 3) Link the uploaded files to it
    if (uploaded.length) {
      try { await addMaintenanceAttachments(requestId, uploaded); }
      catch (err) { console.error(err); attachFailed = true; }
    }

    history.back();                         // closes the sheet
    toast(attachFailed ? "Request sent, but the attachments could not be saved" : "Request sent to your landlord");
    await loadData();                       // so it shows up in the inbox
  } catch (err) {
    console.error(err);
    showFormError("Could not send: " + (err.message || err));
  } finally {
    sendBtn.disabled = false;
    $("compose-close").disabled = false;
    setSending("Send");
  }
});

// ---------- Back button / Escape ----------
window.addEventListener("popstate", () => {
  closeSheet();
  showDetail(false);
  renderAll();                              // refresh the read/unread look of the list
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  setDrawer(false);
  accountMenu.hidden = true;
  if (!sheet.hidden) history.back();
});

// Refresh when the tenant comes back to the page (at most once every 30 seconds)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && user && Date.now() - lastLoad > 30000) loadData();
});

// ---------- Small toast ----------
let toastTimer;
function toast(msg) {
  const el = $("snackbar");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---------- Start ----------
onAuthStateChanged(auth, async (u) => {
  if (!u) {
    window.location.href = "login.html";
    return;
  }
  user = u;
  readKey = `${READ_KEY}.${u.uid}`;
  try { readIds = new Set(JSON.parse(localStorage.getItem(readKey) || "[]")); } catch { readIds = new Set(); }
  renderAll();
  await loadData();
});