lucide.createIcons();

// ---------- Data ----------
// SAMPLE DATA: these arrays are the only things that need to change when Firebase is connected.
// Fill them from Firestore (leases / payments / invoices) and call renderAll().
const MONTH_LABEL = 'November 2026';
const PERIOD = 'Nov 2026';
const METHODS = ['Cash', 'GCash', 'Bank Transfer'];

const leases = [
    { unit: '01', name: 'Luigi I. Bautista',   type: 'Residential', start: 'Mar 11, 2026', end: 'Dec 9, 2027', rent: 15000 },
    { unit: '02', name: 'Jahred Lapiz',        type: 'Residential', start: 'Jul 5, 2026',  end: 'Dec 9, 2027', rent: 15000 },
    { unit: '03', name: 'Brandon Ruiz',        type: 'Residential', start: 'Oct 12, 2026', end: 'Dec 9, 2027', rent: 15000 },
    { unit: '04', name: 'Lance Vincent Darum', type: 'Residential', start: 'Jun 17, 2026', end: 'Dec 9, 2027', rent: 15000 },
    { unit: '05', name: 'Tressen Valdez',      type: 'Residential', start: 'Dec 12, 2026', end: 'Dec 9, 2027', rent: 15000 },
    { unit: '06', name: 'Elvis Escobido',      type: 'Residential', start: 'Sep 21, 2026', end: 'Dec 9, 2027', rent: 15000 },
];

// date is ISO (yyyy-mm-dd) so it sorts correctly
let payments = [
    { id: 1, unit: '01', date: '2026-11-01', for: 'Nov 2026', method: 'GCash',         ref: 'GC-48213',  amount: 15000 },
    { id: 2, unit: '02', date: '2026-10-25', for: 'Nov 2026', method: 'Bank Transfer', ref: 'BT-77120',  amount: 15000 },
    { id: 3, unit: '03', date: '2026-10-20', for: 'Nov 2026', method: 'Cash',          ref: '',          amount: 15000 },
    { id: 4, unit: '06', date: '2026-10-18', for: 'Nov 2026', method: 'GCash',         ref: 'GC-47002',  amount: 15000 },
    { id: 5, unit: '04', date: '2026-09-17', for: 'Oct 2026', method: 'Cash',          ref: '',          amount: 15000 },
    { id: 6, unit: '01', date: '2026-10-02', for: 'Oct 2026', method: 'GCash',         ref: 'GC-45510',  amount: 15000 },
    { id: 7, unit: '02', date: '2026-09-28', for: 'Oct 2026', method: 'Bank Transfer', ref: 'BT-76344',  amount: 15000 },
];

// One invoice per tenant for the current period. status: paid | overdue
let invoices = [
    { no: 'INV-2026-11-01', unit: '01', due: 'Nov 5, 2026', status: 'paid'    },
    { no: 'INV-2026-11-02', unit: '02', due: 'Nov 5, 2026', status: 'paid'    },
    { no: 'INV-2026-11-03', unit: '03', due: 'Nov 5, 2026', status: 'paid'    },
    { no: 'INV-2026-11-04', unit: '04', due: 'Nov 5, 2026', status: 'overdue' },
    { no: 'INV-2026-11-05', unit: '05', due: 'Nov 5, 2026', status: 'overdue' },
    { no: 'INV-2026-11-06', unit: '06', due: 'Nov 5, 2026', status: 'paid'    },
];

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const peso = n => '₱' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const leaseOf = unit => leases.find(l => l.unit === unit);
const fmtDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const state = { tab: 'payments', filter: 'all', query: '' };

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
    const rentOf = i => leaseOf(i.unit).rent;
    const collected = invoices.filter(i => i.status === 'paid').reduce((t, i) => t + rentOf(i), 0);
    const owed = invoices.filter(i => i.status === 'overdue').reduce((t, i) => t + rentOf(i), 0);
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
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
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
    $('payments-empty').hidden = rows.length !== 0;
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
    $('invoices-empty').hidden = rows.length !== 0;
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

function section(title, rows) {
    const s = document.createElement('div');
    s.className = 'detail-section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    rows.forEach(([k, v]) => {
        const r = document.createElement('div');
        r.className = 'detail-row';
        const a = document.createElement('span'), b = document.createElement('span');
        a.textContent = k;
        b.textContent = v;
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
            ['Date paid', fmtDate(item.date)],
            ['Covers', item.for],
            ['Method', item.method],
            ['Reference', item.ref || '—'],
        ]));
        // Match the payment to its invoice so it can be downloaded
        currentInvoice = invoices.find(i => i.unit === item.unit && PERIOD === item.for) || null;
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

    body.append(section('Tenant & Lease', [
        ['Tenant', l.name],
        ['Unit', l.unit],
        ['Lease type', l.type],
        ['Lease term', l.start + ' → ' + l.end],
        ['Monthly rent', peso(l.rent)],
    ]));

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

chipGroup($('tenant-chips'), 'unit', leases.map(l => [l.unit, `Unit ${l.unit} · ${l.name}`]), unit => {
    recordForm.elements.amount.value = leaseOf(unit).rent;   // default to the monthly rent
});
chipGroup($('method-chips'), 'method', METHODS.map(m => [m, m]));

const todayISO = () => new Date().toISOString().slice(0, 10);

$('record-btn').addEventListener('click', () => {
    recordForm.reset();
    recordForm.elements.date.value = todayISO();
    recordError.hidden = true;
    recordModal.hidden = false;
});

$('record-cancel').addEventListener('click', () => recordModal.hidden = true);
recordModal.addEventListener('click', e => { if (e.target === recordModal) recordModal.hidden = true; });

function showError(msg) { recordError.textContent = msg; recordError.hidden = false; }

recordForm.addEventListener('submit', e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(recordForm));
    if (!d.unit)   return showError('Choose a tenant.');
    if (!d.method) return showError('Choose a payment method.');

    const amount = Number(d.amount);
    if (!(amount > 0)) return showError('Enter a valid amount.');

    // When Firebase is connected, save this to Firestore instead of just the local arrays.
    payments.push({
        id: Date.now(),
        unit: d.unit,
        date: d.date,
        for: PERIOD,
        method: d.method,
        ref: (d.ref || '').trim(),
        amount,
    });

    // A payment that covers the rent clears the tenant's overdue invoice
    const inv = invoices.find(i => i.unit === d.unit);
    if (inv && amount >= leaseOf(d.unit).rent) inv.status = 'paid';

    recordModal.hidden = true;
    renderAll();
});

// ---------- Escape closes modals ----------
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    recordModal.hidden = true;
    detailModal.hidden = true;
});

// ---------- Start ----------
function renderAll() {
    renderSummary();
    renderPayments();
    renderInvoices();
    lucide.createIcons();
}

renderAll();