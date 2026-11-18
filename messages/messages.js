lucide.createIcons();

// ---------- Message data ----------
// SAMPLE DATA: this array is the only thing that needs to change when Firebase is connected.
// Fill it from Firestore (e.g. onSnapshot on a "messages" collection) and call renderList().
// `file` is the attachment's filename; later it can hold a Storage URL for the real photo/video.
let messages = [
    { id: 1, name: 'Luigi I. Bautista',   unit: '01', text: 'Leaking pipe in bathroom ceiling — water dripping onto floor tiles.',       file: 'bathroom_leak.jpg',  time: 'Today 10:42 AM', unread: true  },
    { id: 2, name: 'Jahred Lapiz',        unit: '02', text: 'Broken window latch on east-facing bedroom window — security concern.',      file: 'window_latch.jpg',   time: 'Yesterday',      unread: false },
    { id: 3, name: 'Brandon Ruiz',        unit: '03', text: 'Mold growth spotted on bathroom wall near shower grout lines.',              file: 'mold_wall.jpg',      time: 'Oct 12',         unread: false },
    { id: 4, name: 'Lance Vincent Darum', unit: '04', text: 'Air conditioning unit making loud rattling noise — not cooling properly.',   file: 'ac_unit.jpg',        time: 'Oct 10',         unread: false },
    { id: 5, name: 'Tressen Valdez',      unit: '05', text: 'Electrical outlet in kitchen sparking — tripped circuit breaker twice.',     file: 'outlet_damage.jpg',  time: 'Oct 08',         unread: false },
    { id: 6, name: 'Elvis Escobido',      unit: '06', text: 'Hallway ceiling light fixture broken — common area left in darkness at night.', file: 'ceiling_light.jpg', time: 'Oct 05',         unread: false },
];

// Tenants shown as recipients in the compose window (one per unit)
const tenants = [...new Map(messages.map(m => [m.unit, { unit: m.unit, name: m.name }])).values()];

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
    emptyEl.hidden = shown.length !== 0;
    lucide.createIcons();
}

// ---------- Open / close a message ----------
function openMessage(id) {
    const m = messages.find(x => x.id === Number(id));
    if (!m) return;
    m.unread = false;

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
    messages.forEach(m => { m.unread = false; });
    closeMenus();
    renderList();
});

// ---------- Compose ----------
const composeModal = document.getElementById('compose-modal');
const composeForm  = document.getElementById('compose-form');
const composeError = document.getElementById('compose-error');
const toChips      = document.getElementById('to-chips');

tenants.forEach(t => {
    const label = document.createElement('label');
    label.className = 'to-chip';
    label.innerHTML = '<input type="radio" name="to"><span></span>';
    label.querySelector('input').value = t.unit;
    label.querySelector('span').textContent = `Unit ${t.unit} · ${t.name}`;
    toChips.appendChild(label);
});

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
    // When Firebase is connected, save this to Firestore instead of just the local array.
    messages.unshift({
        id: Date.now(),
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

// ---------- Start ----------
renderList();