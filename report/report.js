import { requireLogin, listLeases, listPayments, listMaintenance } from '../shared/firebase.js';

lucide.createIcons();

// ---------- Data ----------
// Everything below is built from the database (leases + payments) in loadData().
const TOTAL_UNITS = 15;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const now = new Date();
const MONTH_LABEL = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

let tenants = [];     // one row per active lease: { unit, name, rent, status, last }
let history = [];     // last 12 months: { m, full, expected, collected }
let issues  = [];     // maintenance requests: { unit, name, title, status }
const ISSUE_LABEL = { open: 'Open', progress: 'In progress', done: 'Resolved' };

let expected = 0, collected = 0, owed = 0, paidCount = 0, overdueCount = 0, vacant = TOTAL_UNITS;

const sum   = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
const peso  = n => '₱' + Number(n).toLocaleString('en-US');
const pesoK = n => '₱' + Math.round(n / 1000) + 'k';
const pct   = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const $     = id => document.getElementById(id);

const isoDay = v => String(v).slice(0, 10);
const mdy    = v => { const [y, m, d] = isoDay(v).split('-'); return `${m}/${d}/${y}`; };
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;

// The unit number is stored at the start of the property name ("Unit 01" or "Unit 01 – Sunrise")
function unitOf(lease) {
    const m = /^Unit\s+(\d+)/i.exec(lease.property?.name || '');
    return m ? m[1].padStart(2, '0') : '--';
}

async function loadData() {
    const [leases, payments] = await Promise.all([listLeases(), listPayments()]);
    // Maintenance is optional: the report still loads if that query isn't deployed yet
    const maintenance = await listMaintenance().catch(err => {
        console.warn('Could not load maintenance requests:', err);
        return [];
    });

    const byId = new Map(leases.map(l => [l.id, l]));
    const paidPayments = payments.filter(p =>
        String(p.status).toLowerCase() === 'paid' && p.paymentDate);

    // Payment amount: the payment's own amount, or the lease's monthly rent if there isn't one
    const amountOf = p => {
        const n = Number(p.amount);
        return p.amount != null && Number.isFinite(n) ? n : Number(byId.get(p.lease?.id)?.monthlyRent || 0);
    };

    const thisMonth = monthKey(now.getFullYear(), now.getMonth());
    const paidIds = new Set(
        paidPayments.filter(p => isoDay(p.paymentDate).startsWith(thisMonth)).map(p => p.lease.id));

    const lastPaid = new Map();   // lease id -> date of its latest paid payment
    paidPayments.forEach(p => {
        const d = isoDay(p.paymentDate);
        if (!lastPaid.has(p.lease.id) || d > lastPaid.get(p.lease.id)) lastPaid.set(p.lease.id, d);
    });

    const active = leases
        .filter(l => !l.tenant.isArchived)
        .sort((a, b) => unitOf(a).localeCompare(unitOf(b)));

    tenants = active.map(l => ({
        unit: unitOf(l),
        name: `${l.tenant.firstName} ${l.tenant.lastName}`,
        rent: Number(l.monthlyRent),
        status: paidIds.has(l.id) ? 'paid' : 'overdue',
        last: lastPaid.has(l.id) ? mdy(lastPaid.get(l.id)) : '—',
    }));

    expected     = sum(tenants, t => t.rent);
    collected    = sum(tenants.filter(t => t.status === 'paid'), t => t.rent);
    owed         = expected - collected;
    paidCount    = tenants.filter(t => t.status === 'paid').length;
    overdueCount = tenants.length - paidCount;
    vacant       = Math.max(TOTAL_UNITS - tenants.length, 0);

    // Maintenance requests: unit comes from the property name, tenant from the lease on that unit
    const issueStatus = r => {
        const s = String(r.status).toLowerCase();
        if (r.resolutionDate || /resolv|done|complete|closed|fixed/.test(s)) return 'done';
        if (/progress|ongoing|assigned|scheduled/.test(s)) return 'progress';
        return 'open';
    };
    const ORDER = { open: 0, progress: 1, done: 2 };
    issues = maintenance
        .map(r => {
            const unit = unitOf(r);
            return {
                unit,
                name: tenants.find(t => t.unit === unit)?.name || '—',
                title: r.title,
                status: issueStatus(r),
            };
        })
        .sort((a, b) => ORDER[a.status] - ORDER[b.status])
        .slice(0, 6);

    // Rent per month for the last 12 months. The current month matches the cards above;
    // earlier months use the leases running that month and the payments dated in it.
    history = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d.getFullYear(), d.getMonth());
        const first = `${key}-01`;
        const last = `${key}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

        const isNow = i === 0;
        history.push({
            m: MONTHS[d.getMonth()].slice(0, 3),
            full: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
            expected: isNow ? expected : sum(
                leases.filter(l => isoDay(l.startDate) <= last && isoDay(l.endDate) >= first),
                l => Number(l.monthlyRent)),
            collected: isNow ? collected : sum(
                paidPayments.filter(p => isoDay(p.paymentDate).startsWith(key)), amountOf),
        });
    }
}

// ---------- KPI cards ----------
function renderKpis() {
    $('rep-month').textContent = MONTH_LABEL;

    $('kpi-expected').textContent = peso(expected);
    $('kpi-expected-badge').textContent = tenants.length + ' leases';

    $('kpi-collected').textContent = peso(collected);
    $('kpi-collected-badge').textContent = pct(collected, expected) + '% collected';

    $('kpi-owed').textContent = peso(owed);
    $('kpi-owed-badge').textContent = overdueCount + ' overdue';

    $('kpi-occ').textContent = String(tenants.length).padStart(2, '0') + '/' + TOTAL_UNITS;
    $('kpi-occ-badge').textContent = vacant + ' vacant';
}

// ---------- Bar chart ----------
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
}

const chartEl = $('bar-chart');
const wrapEl  = $('chart-wrap');
const tipEl   = $('chart-tip');
let period = 6;

function renderBars() {
    const data = history.slice(-period);
    const W = 780, H = 270, padL = 52, padR = 12, padT = 14, padB = 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const top = Math.ceil(Math.max(...data.map(d => d.expected)) / 20000) * 20000 || 20000;
    const y = v => padT + plotH - (v / top) * plotH;

    chartEl.innerHTML = '';
    tipEl.hidden = true;

    // gridlines + y labels
    for (let i = 0; i <= 4; i++) {
        const v = (top / 4) * i;
        el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'chart-grid' }, chartEl);
        const t = el('text', { x: padL - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-label' }, chartEl);
        t.textContent = v === 0 ? '₱0' : pesoK(v);
    }

    const groupW = plotW / data.length;
    const barW = Math.min(30, groupW * 0.3);

    data.forEach((d, i) => {
        const gx = padL + groupW * i;
        const cx = gx + groupW / 2;
        const g = el('g', { class: 'bar-group' }, chartEl);

        el('rect', { x: gx + 4, y: padT, width: groupW - 8, height: plotH, rx: 10, class: 'hit' }, g);

        [['expected', cx - barW - 2], ['collected', cx + 2]].forEach(([key, x], j) => {
            const h = Math.max((d[key] / top) * plotH, d[key] ? 2 : 0);
            const bar = el('rect', {
                x, y: padT + plotH - h, width: barW, height: h, rx: 5,
                class: 'bar-' + key,
            }, g);
            bar.style.animationDelay = (i * 60 + j * 40) + 'ms';
        });

        const lbl = el('text', { x: cx, y: H - 12, 'text-anchor': 'middle', class: 'chart-label' }, g);
        lbl.textContent = d.m;

        g.addEventListener('mouseenter', () => showTip(g, d));
        g.addEventListener('mouseleave', () => { tipEl.hidden = true; });
    });

    const e = sum(data, d => d.expected), c = sum(data, d => d.collected);
    $('chart-rate').innerHTML = 'Collection rate <strong>' + pct(c, e) + '%</strong>';
}

function showTip(g, d) {
    const r = g.getBoundingClientRect(), w = wrapEl.getBoundingClientRect();
    tipEl.innerHTML = '<b></b>Expected: <span class="e"></span><br>Collected: <span class="c"></span>';
    tipEl.querySelector('b').textContent = d.full;
    tipEl.querySelector('.e').textContent = peso(d.expected);
    tipEl.querySelector('.c').textContent = peso(d.collected);
    tipEl.style.left = (r.left - w.left + r.width / 2) + 'px';
    tipEl.style.top  = (r.top - w.top + 24) + 'px';
    tipEl.hidden = false;
}

// ---------- Donut ----------
function renderDonut() {
    const svg = $('donut');
    const R = 60, C = 2 * Math.PI * R;
    const segs = [
        { label: 'Paid',    n: paidCount,    color: '#9db89a', cls: 'dot-paid' },
        { label: 'Overdue', n: overdueCount, color: '#e99a69', cls: 'dot-overdue' },
        { label: 'Vacant',  n: vacant,       color: '#5a5c62', cls: 'dot-vacant' },
    ];

    svg.innerHTML = '';
    el('circle', { cx: 80, cy: 80, r: R, class: 'donut-track' }, svg);

    let offset = 0;
    segs.forEach(s => {
        if (!s.n) return;
        const len = (s.n / TOTAL_UNITS) * C;
        const gap = segs.filter(x => x.n).length > 1 ? 3 : 0;
        const c = el('circle', {
            cx: 80, cy: 80, r: R, class: 'donut-seg', stroke: s.color,
            'stroke-dasharray': (len - gap) + ' ' + (C - len + gap),
            'stroke-dashoffset': -offset,
        }, svg);
        const title = el('title', {}, c);
        title.textContent = s.label + ': ' + s.n;
        offset += len;
    });

    $('donut-total').textContent = tenants.length + '/' + TOTAL_UNITS;

    const legend = $('donut-legend');
    legend.innerHTML = '';
    segs.forEach(s => {
        const li = document.createElement('li');
        li.innerHTML = '<i></i><span></span><b></b>';
        li.querySelector('i').style.background = s.color;
        li.querySelector('span').textContent = s.label;
        li.querySelector('b').textContent = s.n;
        legend.appendChild(li);
    });
}

// ---------- Tenant payment table ----------
function renderSummary() {
    const body = $('summary-body');
    body.innerHTML = '';
    tenants.forEach(t => {
        const tr = document.createElement('tr');
        if (t.status === 'overdue') tr.className = 'is-overdue';
        tr.innerHTML = `
            <td><div class="tenant-cell"><span class="unit-chip"></span><span class="tenant-name"></span></div></td>
            <td class="num"></td>
            <td class="last"></td>
            <td class="num due"></td>
            <td class="center"><span class="status-badge ${t.status}"></span></td>`;
        tr.querySelector('.unit-chip').textContent = t.unit;
        tr.querySelector('.tenant-name').textContent = t.name;
        tr.children[1].textContent = peso(t.rent);
        const last = tr.querySelector('.last');
        last.textContent = t.last;
        if (t.last === '—') last.classList.add('muted');
        const due = tr.querySelector('.due');
        due.textContent = t.status === 'overdue' ? peso(t.rent) : '₱0';
        due.classList.add(t.status === 'overdue' ? 'owed' : 'muted');
        tr.querySelector('.status-badge').textContent = t.status === 'paid' ? 'Paid' : 'Overdue';
        body.appendChild(tr);
    });
}

// ---------- Maintenance list ----------
function renderIssues() {
    const list = $('issue-list');
    list.innerHTML = '';
    if (!issues.length) {
        const li = document.createElement('li');
        li.textContent = 'No maintenance requests recorded yet.';
        li.style.cssText = 'padding:16px 4px;font-size:0.85rem;color:#92949c;';
        list.appendChild(li);
        return;
    }
    issues.forEach(i => {
        const li = document.createElement('li');
        li.className = 'issue-row';
        li.innerHTML = `
            <span class="unit-chip"></span>
            <div class="issue-text"><p class="issue-title"></p><p class="issue-sub"></p></div>
            <span class="tag ${i.status}"></span>`;
        li.querySelector('.unit-chip').textContent = i.unit;
        li.querySelector('.issue-title').textContent = i.title;
        li.querySelector('.issue-sub').textContent = i.name;
        li.querySelector('.tag').textContent = ISSUE_LABEL[i.status];
        list.appendChild(li);
    });
}

// ---------- Period dropdown ----------
const dd     = $('period-dd');
const ddBtn  = $('period-btn');
const ddMenu = $('period-menu');
const ytd = ddMenu.querySelector('li[data-n="11"]');
if (ytd) ytd.dataset.n = String(now.getMonth() + 1);

function setDropdown(open) {
    ddMenu.hidden = !open;
    dd.classList.toggle('open', open);
}

ddBtn.addEventListener('click', e => {
    e.stopPropagation();
    setDropdown(ddMenu.hidden);
});

ddMenu.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', e => {
        e.stopPropagation();
        period = Number(li.dataset.n);
        ddMenu.querySelectorAll('li').forEach(x => x.classList.toggle('selected', x === li));
        $('period-label').textContent = li.textContent;
        setDropdown(false);
        renderBars();
    });
});

document.addEventListener('click', () => setDropdown(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setDropdown(false); });

// ---------- Export CSV ----------
const csvCell = v => '"' + String(v).replace(/"/g, '""') + '"';

$('export-btn').addEventListener('click', () => {
    const rows = [
        ['Tenere Report', MONTH_LABEL],
        [],
        ['Summary'],
        ['Expected rent', expected],
        ['Collected', collected],
        ['Outstanding', owed],
        ['Occupied units', tenants.length + '/' + TOTAL_UNITS],
        [],
        ['Tenant payments'],
        ['Unit', 'Tenant', 'Monthly rent', 'Last payment', 'Balance due', 'Status'],
        ...tenants.map(t => [t.unit, t.name, t.rent, t.last, t.status === 'overdue' ? t.rent : 0, t.status]),
        [],
        ['Rent collection by month'],
        ['Month', 'Expected', 'Collected'],
        ...history.map(h => [h.full, h.expected, h.collected]),
        ...(issues.length ? [
            [],
            ['Maintenance requests'],
            ['Unit', 'Tenant', 'Issue', 'Status'],
            ...issues.map(i => [i.unit, i.name, i.title, ISSUE_LABEL[i.status]]),
        ] : []),
    ];

    const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenere-report-${monthKey(now.getFullYear(), now.getMonth())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

// ---------- Start ----------
function renderAll() {
    renderKpis();
    renderBars();
    renderDonut();
    renderSummary();
    renderIssues();
    lucide.createIcons();
}

requireLogin()
    .then(loadData)
    .then(renderAll)
    .catch(err => {
        console.error(err);
        $('chart-rate').textContent = 'Could not load data: ' + (err.message || err);
    });