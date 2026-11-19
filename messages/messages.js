import { requireLogin, logout, listLeases, listMaintenance, unitOf } from '../shared/firebase.js';

lucide.createIcons();

// ---------- Message data ----------
// Incoming messages are the maintenance requests in the database. Each one is matched to the
// tenant who leases that property. Messages you send from Compose live only in this session
// until a messages table exists in the database.
let messages  = [];   // { id, name, unit, text, file, time, unread, outgoing? }
let tenants   = [];   // recipients for Compose, one per active lease: { unit, name }
let loadError = '';

// Which complaints this browser has already opened (the database has no read/unread field)
const READ_KEY = 'tenere.readMessages';
const readIds = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); }
    catch { return new Set(); }
})();
const saveRead = () => {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...readIds])); } catch { /* storage blocked */ }
};

const STATUS_LABEL = { open: 'Open', progress: 'In progress', done: 'Resolved' };
const isDone = s => /^(done|resolved|closed|completed)$/i.test(String(s || ''));
const fmtShort = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', timeZone: 'UTC' });

function timeLabel(r) {
    if (isDone(r.status)) return r.resolutionDate ? 'Resolved ' + fmtShort(r.resolutionDate) : 'Resolved';
    const key = String(r.status || '').toLowerCase();
    return STATUS_LABEL[key] || r.status || 'Open';
}

function buildData(leases, requests) {
    const active = leases.filter(l => !l.tenant.isArchived);

    tenants = active
        .map(l => ({ unit: unitOf(l), name: `${l.tenant.firstName} ${l.tenant.lastName}` }))
        .sort((a, b) => a.unit.localeCompare(b.unit));

    // property id -> the lease (and so the tenant) for that property; active tenants win
    const byProperty = new Map();
    leases.forEach(l => {
        const cur = byProperty.get(l.property.id);
        if (!cur || (cur.tenant.isArchived && !l.tenant.isArchived)) byProperty.set(l.property.id, l);
    });

    const incoming = requests.map(r => {
        const lease = byProperty.get(r.property?.id);
        const done = isDone(r.status);
        return {
            id: r.id,
            name: lease ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : (r.property?.name || 'Unknown tenant'),
            unit: unitOf(r),
            text: r.description ? `${r.title} — ${r.description}` : r.title,
            file: null,   // no attachment field in the database yet
            time: timeLabel(r),
            unread: !done && !readIds.has(r.id),
            done,
            resolved: r.resolutionDate ? String(r.resolutionDate).slice(0, 10) : '',
        };
    });

    // Unresolved first (by unit), then resolved with the most recently resolved on top
    incoming.sort((a, b) =>
        (a.done - b.done) ||
        (a.done ? b.resolved.localeCompare(a.resolved) : a.unit.localeCompare(b.unit)));

    // Keep anything sent from Compose this session at the top
    messages = [...messages.filter(m => m.outgoing), ...incoming];
}

// ---------- State + elements ----------
const state = { query: '', filter: 'all' };

const listView   = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const listEl     = document.getElementById('msg-list');
const emptyEl    = document.getElementById('msg-empty');
const countEl    = document.getElementById('msg-count');
const searchEl   = document.getElementById('msg-search');

// ---------- Rendering ----------
function visibleMessages() {
    const q = state.query.trim().toLowerCase();
    return messages.filter(m => {
        if (state.filter === 'unread' && !m.unread) return false;
        if (state.filter === 'files' && !m.file) return false;
        if (!q) return true;
        return [m.name, 'unit ' + m.unit, m.text, m.file || ''].join(' ').toLowerCase().includes(q);
    });
}

function rowEl(m) {
    const li = document.createElement('li');
    li.className = 'msg-row' + (m.unread ? ' unread' : '');
    li.tabIndex = 0;
    li.dataset.id = m.id;
    li.innerHTML = `
        <div class="unit-badge"><span>UNIT</span><strong></strong></div>
        <div class="msg-content">
            <div class="msg-line1"><span class="msg-name"></span><span class="msg-unit"></span></div>
            <p class="msg-text"></p>
            <div class="msg-attach" hidden>
                <span class="msg-thumb"><i data-lucide="image"></i></span>
                <span class="msg-file"><i data-lucide="paperclip"></i><span></span></span>
            </div>
        </div>
        <span class="msg-time"></span>
        <i data-lucide="chevron-right" class="msg-chev"></i>`;

    // textContent everywhere so message text can never inject HTML
    li.querySelector('.unit-badge strong').textContent = m.unit;
    li.querySelector('.msg-name').textContent = m.outgoing ? 'To: ' + m.name : m.name;
    li.querySelector('.msg-unit').textContent = 'Unit ' + m.unit;
    li.querySelector('.msg-text').textContent = m.text;
    li.querySelector('.msg-time').textContent = m.time;
    if (m.file) {
        li.querySelector('.msg-attach').hidden = false;
        li.querySelector('.msg-file span').textContent = m.file;
    }
    return li;
}

function renderList() {
    const shown = visibleMessages();
    listEl.innerHTML = '';
    shown.forEach(m => listEl.appendChild(rowEl(m)));
    countEl.textContent = shown.length;
    emptyEl.textContent = loadError || (messages.length ? 'No messages match.' : 'No complaint messages yet.');
    emptyEl.hidden = shown.length !== 0;
    lucide.createIcons();
}

// ---------- Open / close a message ----------
function openMessage(id) {
    const m = messages.find(x => String(x.id) === String(id));
    if (!m) return;
    m.unread = false;
    if (!m.outgoing) { readIds.add(m.id); saveRead(); }

    document.querySelector('#detail-badge strong').textContent = m.unit;
    document.getElementById('detail-name').textContent = m.outgoing ? 'To: ' + m.name : m.name;
    document.getElementById('detail-unit').textContent = 'Unit ' + m.unit;
    document.getElementById('detail-time').textContent = m.time;
    document.getElementById('detail-text').textContent = m.text;

    const attach = document.getElementById('detail-attach');
    attach.hidden = !m.file;
    document.getElementById('detail-file').textContent = m.file || '';

    listView.hidden = true;
    detailView.hidden = false;
    lucide.createIcons();
}

document.getElementById('back-btn').addEventListener('click', () => {
    detailView.hidden = true;
    listView.hidden = false;
    renderList();
});

// Delegated, so rows added later work too
listEl.addEventListener('click', e => {
    const row = e.target.closest('.msg-row');
    if (row) openMessage(row.dataset.id);
});
listEl.addEventListener('keydown', e => {
    const row = e.target.closest('.msg-row');
    if (row && e.key === 'Enter') openMessage(row.dataset.id);
});

// ---------- Search ----------
searchEl.addEventListener('input', () => {
    state.query = searchEl.value;
    renderList();
});

// ---------- Filter + more menus ----------
const filterBtn  = document.getElementById('filter-btn');
const filterMenu = document.getElementById('filter-menu');
const moreBtn    = document.getElementById('more-btn');
const moreMenu   = document.getElementById('more-menu');

const menus = [
    { btn: filterBtn, menu: filterMenu },
    { btn: moreBtn,   menu: moreMenu },
];

function setMenuOpen(entry, open) {
    entry.menu.hidden = !open;
    entry.btn.setAttribute('aria-expanded', String(open));
}

function closeMenus(except) {
    menus.forEach(entry => { if (entry !== except) setMenuOpen(entry, false); });
}

menus.forEach(entry => {
    entry.btn.addEventListener('click', e => {
        e.stopPropagation();
        const willOpen = entry.menu.hidden;
        closeMenus(willOpen ? entry : null);
        setMenuOpen(entry, willOpen);
    });
    entry.menu.addEventListener('click', e => e.stopPropagation());
});

filterMenu.querySelectorAll('[data-filter]').forEach(item => {
    item.addEventListener('click', () => {
        state.filter = item.dataset.filter;
        filterMenu.querySelectorAll('[data-filter]').forEach(i => i.classList.toggle('selected', i === item));
        filterBtn.classList.toggle('active', state.filter !== 'all');
        closeMenus();
        renderList();
    });
});

document.getElementById('mark-all-read').addEventListener('click', () => {
    messages.forEach(m => {
        m.unread = false;
        if (!m.outgoing) readIds.add(m.id);
    });
    saveRead();
    closeMenus();
    renderList();
});

// ---------- Compose ----------
const composeModal = document.getElementById('compose-modal');
const composeForm  = document.getElementById('compose-form');
const composeError = document.getElementById('compose-error');
const toChips      = document.getElementById('to-chips');

// Recipients are the active tenants from the database, so they are rebuilt after every load
function buildRecipients() {
    toChips.innerHTML = '';
    tenants.forEach(t => {
        const label = document.createElement('label');
        label.className = 'to-chip';
        label.innerHTML = '<input type="radio" name="to"><span></span>';
        label.querySelector('input').value = t.unit;
        label.querySelector('span').textContent = `Unit ${t.unit} · ${t.name}`;
        toChips.appendChild(label);
    });
}

document.getElementById('compose-btn').addEventListener('click', () => {
    composeForm.reset();
    composeError.hidden = true;
    composeModal.hidden = false;
    composeForm.elements.text.focus();
});

document.getElementById('compose-cancel').addEventListener('click', () => composeModal.hidden = true);
composeModal.addEventListener('click', e => { if (e.target === composeModal) composeModal.hidden = true; });

composeForm.addEventListener('submit', e => {
    e.preventDefault();
    const unit = composeForm.elements.to.value;
    const text = composeForm.elements.text.value.trim();

    if (!unit) {
        composeError.textContent = 'Choose who the message is for.';
        composeError.hidden = false;
        return;
    }
    if (!text) {
        composeError.textContent = 'Write a message first.';
        composeError.hidden = false;
        return;
    }

    const tenant = tenants.find(t => t.unit === unit);
    // Not saved to the database yet: there is no messages table, so this stays in the page.
    messages.unshift({
        id: 'out-' + Date.now(),
        name: tenant.name,
        unit: tenant.unit,
        text,
        file: null,
        time: 'Just now',
        unread: false,
        outgoing: true,
    });

    composeModal.hidden = true;
    renderList();
});

// ---------- Global: click outside / Escape ----------
document.addEventListener('click', () => {
    closeMenus();
});

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeMenus();
    composeModal.hidden = true;
});

// ---------- Logout ----------
document.querySelector('.logout-btn')?.addEventListener('click', logout);

// ---------- Load from the database ----------
async function loadData() {
    try {
        const [leases, requests] = await Promise.all([listLeases(), listMaintenance()]);
        buildData(leases, requests);
        loadError = '';
    } catch (err) {
        console.error(err);
        loadError = 'Could not load messages: ' + (err.message || err);
    }
    buildRecipients();
    renderList();
}

// ---------- Start ----------
await requireLogin();
await loadData();