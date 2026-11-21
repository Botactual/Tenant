import {
    requireLogin, logout, listLeases, listMaintenance, listMaintenanceAttachments,
    listMessages, sendMessage, unitOf,
} from '../shared/firebase.js';

lucide.createIcons();

// ---------- Message data ----------
// Incoming messages are the maintenance requests in the database. Each one is matched to the
// tenant who leases that property, and carries any photos/videos the tenant attached.
// Messages you send (Compose or Reply) are saved in the database and show up in the tenant portal.
let messages  = [];   // { id, propertyId, name, unit, text, file, media, time, unread, outgoing? }
let tenants   = [];   // recipients for Compose, one per active lease: { unit, name, propertyId }
let sent      = [];   // landlord messages from the database: { id, body, sentAt, propertyId }
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
const fmtDay  = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtWhen = iso => new Date(iso).toLocaleString('en-US',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Only real https links are ever used for photos/videos
const safeUrl = u => (/^https:\/\//i.test(u || '') ? u : '');

function timeLabel(r) {
    if (isDone(r.status)) return r.resolutionDate ? 'Resolved ' + fmtShort(r.resolutionDate) : 'Resolved';
    const key = String(r.status || '').toLowerCase();
    return STATUS_LABEL[key] || r.status || 'Open';
}

function buildData(leases, requests, attachments, landlordMessages) {
    const active = leases.filter(l => !l.tenant.isArchived);

    tenants = active
        .map(l => ({
            unit: unitOf(l),
            name: `${l.tenant.firstName} ${l.tenant.lastName}`,
            propertyId: l.property.id,
        }))
        .sort((a, b) => a.unit.localeCompare(b.unit));

    // property id -> the lease (and so the tenant) for that property; active tenants win
    const byProperty = new Map();
    leases.forEach(l => {
        const cur = byProperty.get(l.property.id);
        if (!cur || (cur.tenant.isArchived && !l.tenant.isArchived)) byProperty.set(l.property.id, l);
    });

    // request id -> its photos and videos
    const mediaByRequest = new Map();
    attachments.forEach(a => {
        const id = a.request && a.request.id;
        if (!id) return;
        if (!mediaByRequest.has(id)) mediaByRequest.set(id, []);
        mediaByRequest.get(id).push({ name: a.fileName, url: a.fileUrl, type: a.contentType });
    });

    const incoming = requests.map(r => {
        const lease = byProperty.get(r.property?.id);
        const done = isDone(r.status);
        const media = mediaByRequest.get(r.id) || [];
        return {
            id: r.id,
            propertyId: r.property?.id,
            name: lease ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : (r.property?.name || 'Unknown tenant'),
            unit: unitOf(r),
            text: r.description ? `${r.title} — ${r.description}` : r.title,
            file: media.length ? media[0].name : null,
            media,
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

    // Messages you sent to tenants, newest first, kept at the top
    sent = landlordMessages;
    const outgoing = [...landlordMessages]
        .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
        .map(m => {
            const lease = byProperty.get(m.propertyId);
            return {
                id: 'msg-' + m.id,
                propertyId: m.propertyId,
                name: lease ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : 'Tenant',
                unit: lease ? unitOf(lease) : '--',
                text: m.body,
                file: null,
                media: [],
                time: fmtDay(m.sentAt),
                unread: false,
                outgoing: true,
            };
        });

    messages = [...outgoing, ...incoming];
}

// ---------- State + elements ----------
const state = { query: '', filter: 'all' };
let current = null;   // the message that is open in the detail view

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
        const media = m.media || [];
        if (state.filter === 'unread' && !m.unread) return false;
        if (state.filter === 'files' && !media.length) return false;
        if (!q) return true;
        return [m.name, 'unit ' + m.unit, m.text, ...media.map(x => x.name)].join(' ').toLowerCase().includes(q);
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

    const media = m.media || [];
    if (media.length) {
        li.querySelector('.msg-attach').hidden = false;

        // Thumbnail of the first attachment: the photo itself, or a video icon
        const first = media[0];
        const thumb = li.querySelector('.msg-thumb');
        thumb.replaceChildren();
        const url = safeUrl(first.url);
        if (url && /^image\//i.test(first.type || '')) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            thumb.appendChild(img);
        } else {
            const icon = document.createElement('i');
            icon.setAttribute('data-lucide', /^video\//i.test(first.type || '') ? 'video' : 'file');
            thumb.appendChild(icon);
        }

        li.querySelector('.msg-file span').textContent =
            first.name + (media.length > 1 ? ` +${media.length - 1} more` : '');
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
// One photo (click to open full size) or video (with controls), with its file name underneath
function mediaNode(x) {
    const url = safeUrl(x.url);
    if (!url) return null;

    const box = document.createElement('div');
    box.className = 'media-item';

    if (/^video\//i.test(x.type || '')) {
        const v = document.createElement('video');
        v.src = url;
        v.controls = true;
        v.preload = 'metadata';
        box.appendChild(v);
    } else {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = url;
        img.alt = x.name || 'Photo';
        img.loading = 'lazy';
        a.appendChild(img);
        box.appendChild(a);
    }

    const cap = document.createElement('p');
    cap.className = 'media-name';
    cap.textContent = x.name || '';
    box.appendChild(cap);
    return box;
}

// The replies you have already sent to this tenant, oldest first
const threadEl = document.getElementById('thread');

function renderThread() {
    threadEl.replaceChildren();
    const list = current
        ? sent.filter(s => s.propertyId === current.propertyId)
              .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
        : [];

    list.forEach(s => {
        const item = document.createElement('div');
        item.className = 'reply-item';

        const meta = document.createElement('p');
        meta.className = 'reply-meta';
        meta.textContent = 'You · ' + fmtWhen(s.sentAt);

        const body = document.createElement('p');
        body.className = 'reply-body';
        body.textContent = s.body;

        item.append(meta, body);
        threadEl.appendChild(item);
    });
    threadEl.hidden = !list.length;
}

function openMessage(id) {
    const m = messages.find(x => String(x.id) === String(id));
    if (!m) return;
    current = m;
    m.unread = false;
    if (!m.outgoing) { readIds.add(m.id); saveRead(); }

    document.querySelector('#detail-badge strong').textContent = m.unit;
    document.getElementById('detail-name').textContent = m.outgoing ? 'To: ' + m.name : m.name;
    document.getElementById('detail-unit').textContent = 'Unit ' + m.unit;
    document.getElementById('detail-time').textContent = m.time;
    document.getElementById('detail-text').textContent = m.text;

    const mediaBox = document.getElementById('detail-media');
    mediaBox.replaceChildren();
    (m.media || []).forEach(x => {
        const node = mediaNode(x);
        if (node) mediaBox.appendChild(node);
    });
    mediaBox.hidden = !mediaBox.children.length;

    replyText.value = '';
    replyError.hidden = true;
    renderThread();

    listView.hidden = true;
    detailView.hidden = false;
    lucide.createIcons();
}

document.getElementById('back-btn').addEventListener('click', () => {
    // stop any video that is still playing
    document.querySelectorAll('#detail-media video').forEach(v => v.pause());
    current = null;
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

// ---------- Reply (inside an opened message) ----------
const replyForm  = document.getElementById('reply-form');
const replyText  = document.getElementById('reply-text');
const replyError = document.getElementById('reply-error');
const replyBtn   = document.getElementById('reply-send');

replyForm.addEventListener('submit', async e => {
    e.preventDefault();
    const body = replyText.value.trim();

    if (!current || !current.propertyId) {
        replyError.textContent = 'This message has no tenant to reply to.';
        replyError.hidden = false;
        return;
    }
    if (!body) {
        replyError.textContent = 'Write a reply first.';
        replyError.hidden = false;
        return;
    }

    replyBtn.disabled = true;
    replyError.hidden = true;
    try {
        await sendMessage({ propertyId: current.propertyId, body });
        replyText.value = '';
        await loadData();      // pulls the new message in
        renderThread();
    } catch (err) {
        console.error(err);
        replyError.textContent = 'Could not send: ' + (err.message || err);
        replyError.hidden = false;
    } finally {
        replyBtn.disabled = false;
    }
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

composeForm.addEventListener('submit', async e => {
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
    const sendBtn = composeForm.querySelector('button[type="submit"]');
    sendBtn.disabled = true;
    composeError.hidden = true;

    try {
        // Saved in the database, so it shows up in that tenant's portal
        await sendMessage({ propertyId: tenant.propertyId, body: text });
        composeModal.hidden = true;
        await loadData();
    } catch (err) {
        console.error(err);
        composeError.textContent = 'Could not send: ' + (err.message || err);
        composeError.hidden = false;
    } finally {
        sendBtn.disabled = false;
    }
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
        // Attachments and messages are optional: the page still loads if those queries aren't deployed yet
        const attachments = await listMaintenanceAttachments().catch(err => {
            console.warn('Could not load attachments:', err);
            return [];
        });
        const all = await listMessages().catch(err => {
            console.warn('Could not load messages:', err);
            return [];
        });
        const landlordMessages = all
            .filter(m => m.sender === 'landlord' && m.property)
            .map(m => ({ id: m.id, body: m.body, sentAt: m.sentAt, propertyId: m.property.id }));

        buildData(leases, requests, attachments, landlordMessages);
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