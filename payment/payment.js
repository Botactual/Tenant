import { requireLogin, logout, listLeases, listPayments, recordPayment, unitOf } from '../shared/firebase.js';

lucide.createIcons();

// ---------- Setup ----------
const METHODS = ['Cash', 'GCash', 'Bank Transfer'];
const DUE_DAY = 5;   // invoices are due on this day of the month

const MONTHS      = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const THIS_MONTH  = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const MONTH_LABEL = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
const PERIOD      = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

// ---------- Data ----------
// Everything below is built from the database (leases + payments) in loadData().
let leases   = [];   // one per active lease: { id, unit, name, address, start, end, rent, deposit, doc }
let payments = [];   // { id, leaseId, unit, date (ISO), for, method, ref, amount, status, paid }
let invoices = [];   // one per active lease for the current month: { no, unit, leaseId, due, status }
let loadError = '';

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const peso = n => '₱' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const periodOf = iso => {
    const [y, m] = String(iso).slice(0, 10).split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
};
const cap = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
const leaseOf = unit => leases.find(l => l.unit === unit);
const todayISO = () => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const state = { tab: 'payments', filter: 'all', query: '' };

// Turns the database rows into the arrays the page renders from
function buildData(rawLeases, rawPayments) {
    leases = rawLeases
        .filter(l => !l.tenant.isArchived)
        .sort((a, b) => unitOf(a).localeCompare(unitOf(b)))
        .map(l => ({
            id: l.id,
            unit: unitOf(l),
            name: `${l.tenant.firstName} ${l.tenant.lastName}`,
            address: l.property?.address || '',
            start: fmtDate(l.startDate),
            end: fmtDate(l.endDate),
            rent: Number(l.monthlyRent),
            deposit: l.depositAmount,
            doc: l.leaseDocumentUrl || '',
        }));

    const byId = new Map(leases.map(l => [l.id, l]));

    // The database has no "covers" field, so a payment covers the month it was made in
    payments = rawPayments
        .filter(p => p.lease && byId.has(p.lease.id))
        .map(p => {
            const l = byId.get(p.lease.id);
            const date = String(p.paymentDate).slice(0, 10);
            return {
                id: p.id,
                leaseId: l.id,
                unit: l.unit,
                date,
                for: periodOf(date),
                method: p.paymentMethod || '—',
                ref: p.transactionReference || '',
                amount: p.amount != null ? Number(p.amount) : l.rent,
                status: p.status,
                paid: String(p.status).toLowerCase() === 'paid',
            };
        });

    // Same rule as the Dashboard: a lease is Paid when it has a paid payment dated this month
    const paidLeaseIds = new Set(
        payments.filter(p => p.paid && p.date.startsWith(THIS_MONTH)).map(p => p.leaseId)
    );

    const dueISO = `${THIS_MONTH}-${pad(DUE_DAY)}`;
    invoices = leases.map(l => ({
        no: `INV-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${l.unit}`,
        unit: l.unit,
        leaseId: l.id,
        due: fmtDate(dueISO),
        status: paidLeaseIds.has(l.id) ? 'paid' : 'overdue',
    }));
}

// Builds a <tr> from cell specs; text is always set with textContent so nothing can inject HTML
function makeRow(cells, onOpen, overdue) {
    const tr = document.createElement('tr');
    tr.className = 'lease-row' + (overdue ? ' is-overdue' : '');
    tr.tabIndex = 0;
    cells.forEach(c => {
        const td = document.createElement('td');
        if (c.cls) td.className = c.cls;
        if (c.node) td.appendChild(c.node);
        else td.textContent = c.text;
        tr.appendChild(td);
    });
    const chev = document.createElement('td');
    chev.className = 'chev-col';
    chev.innerHTML = '<i data-lucide="chevron-right"></i>';
    tr.appendChild(chev);
    tr.addEventListener('click', onOpen);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') onOpen(); });
    return tr;
}

function tenantNode(l) {
    const wrap = document.createElement('div');
    wrap.className = 'tenant-cell';
    const chip = document.createElement('span');
    chip.className = 'unit-chip';
    chip.textContent = l.unit;
    const name = document.createElement('span');
    name.className = 'tenant-name';
    name.textContent = l.name;
    wrap.append(chip, name);
    return wrap;
}

function badgeNode(status) {
    const b = document.createElement('span');
    b.className = 'status-badge ' + status;
    b.textContent = status === 'paid' ? 'Paid' : 'Overdue';
    return b;
}

const matches = text => !state.query || text.toLowerCase().includes(state.query.trim().toLowerCase());

// ---------- Summary ----------
function renderSummary() {
    const collected = payments
        .filter(p => p.paid && p.date.startsWith(THIS_MONTH))
        .reduce((t, p) => t + p.amount, 0);
    const owed = invoices
        .filter(i => i.status === 'overdue')
        .reduce((t, i) => t + leaseOf(i.unit).rent, 0);
    $('pay-month').textContent = MONTH_LABEL;
    $('sum-collected').textContent = peso(collected);
    $('sum-owed').textContent = peso(owed);
    $('sum-count').textContent = payments.length;
}

// ---------- Payment history ----------
function renderPayments() {
    const body = $('payments-body');
    body.innerHTML = '';
    const rows = [...payments]
        .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)))
        .filter(p => {
            const l = leaseOf(p.unit);
            return matches([l.name, 'unit ' + p.unit, p.ref, p.method].join(' '));
        });

    rows.forEach(p => {
        const l = leaseOf(p.unit);
        const method = document.createElement('span');
        method.className = 'method-tag';
        method.textContent = p.method;
        body.appendChild(makeRow([
            { text: fmtDate(p.date), cls: 'muted' },
            { node: tenantNode(l) },
            { text: p.for },
            { node: method },
            { text: p.ref || '—', cls: p.ref ? '' : 'muted' },
            { text: peso(p.amount), cls: 'num amount' },
        ], () => openDetail('payment', p)));
    });

    const empty = $('payments-empty');
    empty.textContent = loadError || (payments.length ? 'No payments match.' : 'No payments recorded yet.');
    empty.hidden = rows.length !== 0;
}

// ---------- Invoices ----------
function renderInvoices() {
    const body = $('invoices-body');
    body.innerHTML = '';
    const rows = invoices.filter(i => {
        const l = leaseOf(i.unit);
        if (state.filter !== 'all' && i.status !== state.filter) return false;
        return matches([i.no, l.name, 'unit ' + i.unit].join(' '));
    });

    rows.forEach(i => {
        const l = leaseOf(i.unit);
        body.appendChild(makeRow([
            { text: i.no },
            { node: tenantNode(l) },
            { text: PERIOD },
            { text: i.due, cls: 'muted' },
            { text: peso(l.rent), cls: 'num amount' },
            { node: badgeNode(i.status), cls: 'center' },
        ], () => openDetail('invoice', i), i.status === 'overdue'));
    });

    const empty = $('invoices-empty');
    empty.textContent = loadError || (invoices.length ? 'No invoices match.' : 'No active leases yet.');
    empty.hidden = rows.length !== 0;
}

// ---------- Tabs + filter ----------
document.querySelectorAll('.pay-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        document.querySelectorAll('.pay-tab').forEach(b => b.classList.toggle('active', b === btn));
        $('payments-view').hidden = state.tab !== 'payments';
        $('invoices-view').hidden = state.tab !== 'invoices';
        $('invoice-filter').hidden = state.tab !== 'invoices';
    });
});

document.querySelectorAll('.pay-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        document.querySelectorAll('.pay-chip').forEach(c => c.classList.toggle('active', c === chip));
        renderInvoices();
        lucide.createIcons();
    });
});

$('pay-search').addEventListener('input', e => {
    state.query = e.target.value;
    renderPayments();
    renderInvoices();
    lucide.createIcons();
});

// ---------- Detail modal (payment / invoice + lease) ----------
const detailModal = $('detail-modal');
let currentInvoice = null;

// rows are [label, value] or [label, value, true] when the value is a link
function section(title, rows) {
    const s = document.createElement('div');
    s.className = 'detail-section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    rows.forEach(([k, v, isLink]) => {
        const r = document.createElement('div');
        r.className = 'detail-row';
        const a = document.createElement('span'), b = document.createElement('span');
        a.textContent = k;
        if (isLink && /^https?:\/\//i.test(v || '')) {
            const link = document.createElement('a');
            link.href = v; link.target = '_blank'; link.rel = 'noopener';
            link.textContent = 'Open document';
            b.appendChild(link);
        } else {
            b.textContent = v;
        }
        r.append(a, b);
        s.appendChild(r);
    });
    return s;
}

function openDetail(kind, item) {
    const l = leaseOf(item.unit);
    const body = $('detail-body');
    body.innerHTML = '';

    if (kind === 'payment') {
        $('detail-title').textContent = 'Payment Details';
        body.append(section('Payment', [
            ['Amount', peso(item.amount)],
            ['Status', cap(item.status) || '—'],
            ['Date paid', fmtDate(item.date)],
            ['Covers', item.for],
            ['Method', item.method],
            ['Reference', item.ref || '—'],
        ]));
        // Match the payment to its invoice so it can be downloaded
        currentInvoice = invoices.find(i => i.leaseId === item.leaseId && PERIOD === item.for) || null;
    } else {
        $('detail-title').textContent = item.no;
        body.append(section('Invoice', [
            ['Period', PERIOD],
            ['Due date', item.due],
            ['Amount', peso(l.rent)],
            ['Status', item.status === 'paid' ? 'Paid' : 'Overdue'],
        ]));
        currentInvoice = item;
    }

    const leaseRows = [
        ['Tenant', l.name],
        ['Unit', l.unit],
        ['Property', l.address || '—'],
        ['Lease term', l.start + ' → ' + l.end],
        ['Monthly rent', peso(l.rent)],
    ];
    if (l.deposit != null) leaseRows.push(['Deposit', peso(l.deposit)]);
    leaseRows.push(['Lease document', l.doc || '—', true]);
    body.append(section('Tenant & Lease', leaseRows));

    $('detail-download').hidden = !currentInvoice;
    detailModal.hidden = false;
}

$('detail-close').addEventListener('click', () => detailModal.hidden = true);
detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.hidden = true; });

// Simple downloadable invoice (opens as a printable page)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('detail-download').addEventListener('click', () => {
    const inv = currentInvoice;
    if (!inv) return;
    const l = leaseOf(inv.unit);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(inv.no)}</title>
<style>body{font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#222}
h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:20px}
td{padding:8px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right}</style></head><body>
<h1>Tenēre — Invoice</h1><p>${esc(inv.no)}</p>
<table>
<tr><td>Tenant</td><td>${esc(l.name)} (Unit ${esc(l.unit)})</td></tr>
<tr><td>Period</td><td>${esc(PERIOD)}</td></tr>
<tr><td>Due date</td><td>${esc(inv.due)}</td></tr>
<tr><td>Lease term</td><td>${esc(l.start)} → ${esc(l.end)}</td></tr>
<tr><td>Amount</td><td>${esc(peso(l.rent))}</td></tr>
<tr><td>Status</td><td>${inv.status === 'paid' ? 'Paid' : 'Overdue'}</td></tr>
</table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = inv.no + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

// ---------- Record payment ----------
const recordModal = $('record-modal');
const recordForm  = $('record-form');
const recordError = $('record-error');

function chipGroup(container, name, items, onPick) {
    container.innerHTML = '';
    items.forEach(([value, label]) => {
        const lab = document.createElement('label');
        lab.className = 'opt-chip';
        lab.innerHTML = '<input type="radio"><span></span>';
        const input = lab.querySelector('input');
        input.name = name;
        input.value = value;
        lab.querySelector('span').textContent = label;
        if (onPick) input.addEventListener('change', () => onPick(value));
        container.appendChild(lab);
    });
}

// Tenant chips come from the active leases, so they are rebuilt after every load
function buildTenantChips() {
    chipGroup($('tenant-chips'), 'unit', leases.map(l => [l.unit, `Unit ${l.unit} · ${l.name}`]), unit => {
        recordForm.elements.amount.value = leaseOf(unit).rent;   // default to the monthly rent
    });
}
chipGroup($('method-chips'), 'method', METHODS.map(m => [m, m]));

$('record-btn').addEventListener('click', () => {
    recordForm.reset();
    recordForm.elements.date.value = todayISO();
    recordError.hidden = true;
    recordModal.hidden = false;
});

$('record-cancel').addEventListener('click', () => recordModal.hidden = true);
recordModal.addEventListener('click', e => { if (e.target === recordModal) recordModal.hidden = true; });

function showError(msg) { recordError.textContent = msg; recordError.hidden = false; }

recordForm.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(recordForm));
    if (!d.unit)   return showError('Choose a tenant.');
    if (!d.method) return showError('Choose a payment method.');

    const amount = Number(d.amount);
    if (!(amount > 0)) return showError('Enter a valid amount.');

    const saveBtn = recordForm.querySelector('.btn-primary');
    saveBtn.disabled = true;
    try {
        await recordPayment({
            leaseId: leaseOf(d.unit).id,
            amount,
            paymentDate: d.date,
            paymentMethod: d.method,
            transactionReference: (d.ref || '').trim(),
        });
        recordModal.hidden = true;
        await loadData();   // reload so the table, invoices and totals all match the database
    } catch (err) {
        console.error(err);
        showError('Could not save the payment: ' + (err.message || err));
    } finally {
        saveBtn.disabled = false;
    }
});

// ---------- Escape closes modals ----------
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    recordModal.hidden = true;
    detailModal.hidden = true;
});

// ---------- Logout ----------
document.querySelector('.logout-btn')?.addEventListener('click', logout);

// ---------- Load + render ----------
function renderAll() {
    renderSummary();
    renderPayments();
    renderInvoices();
    lucide.createIcons();
}

async function loadData() {
    try {
        const [rawLeases, rawPayments] = await Promise.all([listLeases(), listPayments()]);
        buildData(rawLeases, rawPayments);
        loadError = '';
    } catch (err) {
        console.error(err);
        loadError = 'Could not load payments: ' + (err.message || err);
    }
    buildTenantChips();
    renderAll();
}

// ---------- Start ----------
await requireLogin();
await loadData();