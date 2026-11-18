import { requireLogin, logout, listLeases, listPayments, addTenantWithLease } from '../shared/firebase.js';

lucide.createIcons();

// ---------- Custom rounded dropdowns ----------
// Replaces each <select> with a styled button + menu, keeping the
// original <select> in sync (hidden) so the rest of the code is unchanged.
const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function closeAllDropdowns(except) {
    document.querySelectorAll('.dd.open').forEach(dd => {
        if (dd !== except) {
            dd.classList.remove('open');
            dd.querySelector('.dd-menu').hidden = true;
        }
    });
}

function enhanceSelect(select) {
    const wrap = document.createElement('div');
    wrap.className = 'dd';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('dd-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-btn' + (select.classList.contains('filter-control') ? ' filter-control' : '');
    btn.setAttribute('aria-haspopup', 'listbox');
    const label = document.createElement('span');
    btn.appendChild(label);
    btn.insertAdjacentHTML('beforeend', CHEVRON);

    const menu = document.createElement('ul');
    menu.className = 'dd-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    wrap.append(btn, menu);

    const syncLabel = () => {
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.text : '';
    };

    const buildMenu = () => {
        menu.innerHTML = '';
        [...select.options].forEach((opt, i) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.textContent = opt.text;
            if (i === select.selectedIndex) li.classList.add('selected');
            li.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                select.selectedIndex = i;
                syncLabel();
                select.dispatchEvent(new Event('change', { bubbles: true }));
                wrap.classList.remove('open');
                menu.hidden = true;
            });
            menu.appendChild(li);
        });
    };

    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = menu.hidden;
        closeAllDropdowns(willOpen ? wrap : null);
        if (willOpen) buildMenu();
        menu.hidden = !willOpen;
        wrap.classList.toggle('open', willOpen);
    });

    // Keep the label right after form.reset()
    if (select.form) select.form.addEventListener('reset', () => setTimeout(syncLabel, 0));

    syncLabel();
}

document.querySelectorAll('select').forEach(enhanceSelect);
document.addEventListener('click', () => closeAllDropdowns());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllDropdowns(); });

// ---------- Lease list: filters + clickable rows ----------
const statusSelect = document.getElementById('filter-status');
const unitSelect   = document.getElementById('filter-unit');
const tbody        = document.getElementById('leases-body');
const emptyEl      = document.getElementById('leases-empty');

let loaded = false;   // true once the first load from the database has finished

function applyFilters() {
    let visible = 0;
    const rows = tbody.querySelectorAll('.lease-row');
    rows.forEach(row => {
        const okStatus = statusSelect.value === 'all' || row.dataset.status === statusSelect.value;
        const okUnit   = unitSelect.value   === 'all' || row.dataset.unit   === unitSelect.value;
        row.hidden = !(okStatus && okUnit);
        if (!row.hidden) visible++;
    });
    emptyEl.hidden = visible !== 0;
    if (visible === 0 && loaded) {
        emptyEl.textContent = rows.length === 0
            ? 'No leases yet. Click Add Tenant to create one.'
            : 'No leases match these filters.';
    }
}
statusSelect.addEventListener('change', applyFilters);
unitSelect.addEventListener('change', applyFilters);

// ---------- Tenant details popup ----------
const leaseById   = new Map();
const detailModal = document.getElementById('detail-modal');
const detailBody  = document.getElementById('detail-body');
let lastRow = null;

function detailSection(title, fields) {
    const sec = document.createElement('div');
    sec.className = 'form-section';
    const h = document.createElement('h4');
    h.textContent = title;
    sec.appendChild(h);

    fields.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'detail-row';
        const k = document.createElement('span');
        k.className = 'detail-label';
        k.textContent = label;
        const v = document.createElement('span');
        v.className = 'detail-value';

        if (label === 'Lease document' && /^https?:\/\//i.test(value || '')) {
            const a = document.createElement('a');
            a.href = value; a.target = '_blank'; a.rel = 'noopener';
            a.textContent = 'Open document';
            v.appendChild(a);
        } else {
            v.textContent = value == null || value === '' ? '—' : value;
        }
        row.append(k, v);
        sec.appendChild(row);
    });
    return sec;
}

function openDetail(row) {
    const lease = leaseById.get(row.dataset.leaseId);
    if (!lease) return;
    lastRow = row;

    const t = lease.tenant || {};
    const p = lease.property || {};
    const status = row.dataset.status;

    document.getElementById('detail-name').textContent = `${t.firstName} ${t.lastName}`;
    document.getElementById('detail-sub').textContent = `Unit ${row.dataset.unit}`;
    const badge = document.getElementById('detail-status');
    badge.className = `status-badge ${status}`;
    badge.textContent = status === 'paid' ? 'Paid' : 'Overdue';

    const date  = v => (v ? fmtDate(v) : '');
    const money = v => (v == null || v === '' ? '' : fmtRent(v));

    detailBody.replaceChildren(
        detailSection('Tenant', [
            ['Email', t.email],
            ['Phone', t.phoneNumber],
            ['Emergency contact', t.emergencyContact],
            ['Move-in date', date(t.moveInDate)],
        ]),
        detailSection('Property', [
            ['Name', p.name],
            ['Address', p.address],
            ['Status', p.status],
        ]),
        detailSection('Lease', [
            ['Start date', date(lease.startDate)],
            ['End date', date(lease.endDate)],
            ['Monthly rent', money(lease.monthlyRent)],
            ['Deposit', money(lease.depositAmount)],
            ['Lease document', lease.leaseDocumentUrl],
        ])
    );

    detailBody.scrollTop = 0;
    detailModal.hidden = false;
}

function closeDetail() {
    detailModal.hidden = true;
    if (lastRow) lastRow.focus();
}

// Row click (delegated, so newly added rows work too)
tbody.addEventListener('click', e => {
    const row = e.target.closest('.lease-row');
    if (row) openDetail(row);
});
tbody.addEventListener('keydown', e => {
    const row = e.target.closest('.lease-row');
    if (row && e.key === 'Enter') openDetail(row);
});

document.getElementById('detail-close').addEventListener('click', closeDetail);
detailModal.addEventListener('click', e => { if (e.target === detailModal) closeDetail(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !detailModal.hidden) closeDetail(); });

// ---------- Load leases from the database ----------
const fmtDate = v => new Date(v + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtRent = n => '₱' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

// The unit number is stored at the start of the property name ("Unit 01" or "Unit 01 – Sunrise")
function unitOf(lease) {
    const m = /^Unit\s+(\d+)/i.exec(lease.property?.name || '');
    return m ? m[1].padStart(2, '0') : '--';
}

function leaseRow(lease, paidLeaseIds) {
    const unit = unitOf(lease);
    const status = paidLeaseIds.has(lease.id) ? 'paid' : 'overdue';

    // Fill text with textContent so names can't inject HTML
    const tr = document.createElement('tr');
    tr.className = 'lease-row' + (status === 'overdue' ? ' is-overdue' : '');
    tr.dataset.unit = unit;
    tr.dataset.leaseId = lease.id;
    tr.dataset.status = status;
    tr.tabIndex = 0;
    tr.innerHTML = `
        <td><div class="tenant-cell"><span class="unit-chip"></span><span class="tenant-name"></span></div></td>
        <td class="type"></td>
        <td class="term"><span class="s"></span> <span class="arrow">→</span> <span class="e"></span></td>
        <td class="num"></td>
        <td class="center"><span class="status-badge ${status}"></span></td>
        <td class="chev-col"><i data-lucide="chevron-right"></i></td>`;
    tr.querySelector('.unit-chip').textContent = unit;
    tr.querySelector('.tenant-name').textContent = `${lease.tenant.firstName} ${lease.tenant.lastName}`;
    tr.querySelector('.type').textContent = 'Residential';
    tr.querySelector('.s').textContent = fmtDate(lease.startDate);
    tr.querySelector('.e').textContent = fmtDate(lease.endDate);
    tr.querySelector('.num').textContent = fmtRent(lease.monthlyRent);
    tr.querySelector('.status-badge').textContent = status === 'paid' ? 'Paid' : 'Overdue';
    return tr;
}

// ---------- Live numbers: stat cards, recent payments, notifications ----------
const TOTAL_UNITS = 15;
const $id = id => document.getElementById(id);
const sumBy = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
const fullName = l => (l ? `${l.tenant.firstName} ${l.tenant.lastName}` : '—');

// Payment amount: uses the payment's own amount, or the lease's monthly rent if there isn't one
function payAmount(p, lease) {
    const n = Number(p.amount);
    return p.amount != null && Number.isFinite(n) ? n : Number(lease?.monthlyRent || 0);
}

const isoDay = v => String(v).slice(0, 10);

function renderStats(active, paidLeaseIds, month) {
    const expected  = sumBy(active, l => Number(l.monthlyRent));
    const collected = sumBy(active.filter(l => paidLeaseIds.has(l.id)), l => Number(l.monthlyRent));
    const overdueN  = active.filter(l => !paidLeaseIds.has(l.id)).length;
    const newN      = active.filter(l => isoDay(l.startDate).startsWith(month)).length;
    const tenantN   = new Set(active.map(l => l.tenant.id ?? fullName(l))).size;

    $id('stat-leases').textContent        = `${String(active.length).padStart(2, '0')}/${TOTAL_UNITS}`;
    $id('stat-leases-badge').textContent  = `${Math.max(TOTAL_UNITS - active.length, 0)} Vacant`;

    $id('stat-owed').textContent          = fmtRent(expected - collected);
    $id('stat-owed-badge').textContent    = `${overdueN} Overdue`;

    $id('stat-rent').textContent          = fmtRent(expected);
    $id('stat-rent-badge').textContent    = `${expected ? Math.round((collected / expected) * 100) : 0}% collected`;

    $id('stat-tenants').textContent       = String(tenantN);
    $id('stat-tenants-badge').textContent = `+${newN} New`;
}

function renderRecentPayments(allLeases, payments) {
    const byId = new Map(allLeases.map(l => [l.id, l]));
    const rows = payments
        .filter(p => p.paymentDate)
        .sort((a, b) => isoDay(b.paymentDate).localeCompare(isoDay(a.paymentDate)))
        .slice(0, 3);

    const body = $id('recent-payments');
    body.innerHTML = '';

    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="pay-date">No payments recorded yet.</td>';
        body.appendChild(tr);
        return;
    }

    rows.forEach(p => {
        const lease = byId.get(p.lease?.id);
        const [y, m, d] = isoDay(p.paymentDate).split('-');
        const status = String(p.status).toLowerCase();

        const tr = document.createElement('tr');
        tr.innerHTML = '<td class="pay-date"></td><td></td><td></td><td><span class="status-badge"></span></td>';
        tr.children[0].textContent = `${m}/${d}/${y}`;
        tr.children[1].textContent = fullName(lease);
        tr.children[2].textContent = fmtRent(payAmount(p, lease));
        const badge = tr.querySelector('.status-badge');
        badge.classList.add(status === 'paid' ? 'paid' : 'overdue');
        badge.textContent = status === 'paid' ? 'Paid' : status.charAt(0).toUpperCase() + status.slice(1);
        body.appendChild(tr);
    });
}

function daysAgo(iso) {
    const today = new Date().toISOString().slice(0, 10);
    return Math.round((Date.parse(today) - Date.parse(isoDay(iso))) / 86400000);
}

function renderNotifications(active, allLeases, payments, paidLeaseIds) {
    const byId = new Map(allLeases.map(l => [l.id, l]));
    const items = [];

    active.filter(l => !paidLeaseIds.has(l.id)).forEach(l => items.push({
        icon: 'triangle-alert', tone: 'warn', unread: true,
        title: 'Rent overdue', sub: `Unit ${unitOf(l)} · ${fullName(l)}`, time: 'Unpaid',
    }));

    payments
        .filter(p => p.paymentDate && String(p.status).toLowerCase() === 'paid')
        .sort((a, b) => isoDay(b.paymentDate).localeCompare(isoDay(a.paymentDate)))
        .slice(0, 2)
        .forEach(p => {
            const lease = byId.get(p.lease?.id);
            const ago = daysAgo(p.paymentDate);
            items.push({
                icon: 'circle-check', tone: 'ok', unread: ago <= 2,
                title: 'Payment received', sub: `${fullName(lease)} · ${fmtRent(payAmount(p, lease))}`,
                time: ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : fmtDate(isoDay(p.paymentDate)),
            });
        });

    const newest = [...active].sort((a, b) => isoDay(b.startDate).localeCompare(isoDay(a.startDate)))[0];
    if (newest && daysAgo(newest.startDate) >= 0 && daysAgo(newest.startDate) <= 30) {
        items.push({
            icon: 'user-plus', tone: 'info', unread: false,
            title: 'New tenant added', sub: `Unit ${unitOf(newest)} · ${fullName(newest)}`,
            time: fmtDate(isoDay(newest.startDate)),
        });
    }

    const list = $id('notif-list');
    list.innerHTML = '';

    if (!items.length) {
        const li = document.createElement('li');
        li.className = 'notif-item';
        li.innerHTML = '<div class="notif-text"><p class="notif-title">You\u2019re all caught up</p></div>';
        list.appendChild(li);
    }

    items.slice(0, 8).forEach(it => {
        const li = document.createElement('li');
        li.className = 'notif-item' + (it.unread ? ' unread' : '');
        li.innerHTML = `
            <span class="notif-icon ${it.tone}"><i data-lucide="${it.icon}"></i></span>
            <div class="notif-text"><p class="notif-title"></p><p class="notif-sub"></p></div>
            <span class="notif-time"></span>`;
        li.querySelector('.notif-title').textContent = it.title;
        li.querySelector('.notif-sub').textContent = it.sub;
        li.querySelector('.notif-time').textContent = it.time;
        list.appendChild(li);
    });

    refreshNotifDot();
}

async function loadLeases() {
    try {
        const [leases, payments] = await Promise.all([listLeases(), listPayments()]);

        // A lease counts as Paid when it has a paid payment dated this month
        const month = new Date().toISOString().slice(0, 7);
        const paidLeaseIds = new Set(
            payments
                .filter(p => String(p.status).toLowerCase() === 'paid' && String(p.paymentDate).startsWith(month))
                .map(p => p.lease.id)
        );

        const active = leases
            .filter(l => !l.tenant.isArchived)
            .sort((a, b) => unitOf(a).localeCompare(unitOf(b)));

        leaseById.clear();
        active.forEach(l => leaseById.set(l.id, l));

        tbody.innerHTML = '';
        active.forEach(l => tbody.appendChild(leaseRow(l, paidLeaseIds)));

        // Rebuild the Unit filter from the loaded leases, keeping the current choice
        const previous = unitSelect.value;
        while (unitSelect.options.length > 1) unitSelect.remove(1);
        [...new Set(active.map(unitOf))].forEach(u => unitSelect.add(new Option(`Unit ${u}`, u)));
        unitSelect.value = [...unitSelect.options].some(o => o.value === previous) ? previous : 'all';

        renderStats(active, paidLeaseIds, month);
        renderRecentPayments(leases, payments);
        renderNotifications(active, leases, payments, paidLeaseIds);

        loaded = true;
        lucide.createIcons();
        applyFilters();
    } catch (err) {
        console.error(err);
        loaded = false;
        emptyEl.hidden = false;
        emptyEl.textContent = 'Could not load leases: ' + (err.message || err);
    }
}

// ---------- Add tenant ----------
const modal = document.getElementById('tenant-modal');
const form  = document.getElementById('tenant-form');
const errEl = document.getElementById('tenant-error');

function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }

document.getElementById('add-tenant-btn').addEventListener('click', () => {
    form.reset();
    errEl.hidden = true;
    modal.hidden = false;
    form.elements.firstName.focus();
});

document.getElementById('tenant-cancel').addEventListener('click', () => modal.hidden = true);
modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });

form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const unit = String(d.unit).padStart(2, '0');

    if (tbody.querySelector(`[data-unit="${unit}"]`)) {
        return showError(`Unit ${unit} already has a lease.`);
    }
    if (d.endDate < d.startDate) {
        return showError('End date must be after the start date.');
    }

    // Optional fields are left out when empty
    const opt = (key, value) => (value === '' || value == null ? {} : { [key]: value });
    const customName = d.propertyName.trim();

    const property = {
        name: `Unit ${unit}` + (customName ? ` – ${customName}` : ''),
        address: d.address.trim(),
        status: d.propertyStatus,
    };
    const tenant = {
        firstName: d.firstName.trim(),
        lastName: d.lastName.trim(),
        email: d.email.trim(),
        phoneNumber: d.phoneNumber.trim(),
        isArchived: d.isArchived === 'on',
        ...opt('emergencyContact', d.emergencyContact.trim()),
        ...opt('moveInDate', d.moveInDate),
    };
    const lease = {
        startDate: d.startDate,
        endDate: d.endDate,
        monthlyRent: Number(d.monthlyRent),
        ...opt('depositAmount', d.depositAmount === '' ? '' : Number(d.depositAmount)),
        ...opt('leaseDocumentUrl', d.leaseDocumentUrl.trim()),
    };

    const saveBtn = form.querySelector('.btn-primary');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errEl.hidden = true;

    try {
        await addTenantWithLease({ property, tenant, lease });
        modal.hidden = true;
        await loadLeases();
    } catch (err) {
        console.error(err);
        showError('Could not save: ' + (err.message || err));
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
});

// ---------- Notifications dropdown ----------
const notifToggle = document.getElementById('notif-toggle');   // the arrow button
const notifPanel  = document.getElementById('notif-panel');
const notifDot    = document.getElementById('notif-dot');

function setNotifOpen(open) {
    notifPanel.hidden = !open;
    notifToggle.setAttribute('aria-expanded', String(open));
}

notifToggle.addEventListener('click', e => {
    e.stopPropagation();
    setNotifOpen(notifPanel.hidden);
});

// Clicks inside the panel shouldn't close it; clicks anywhere else do
notifPanel.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => setNotifOpen(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setNotifOpen(false); });

// Clicking a notification marks it read; the red dot on the bell hides when none are left
function refreshNotifDot() {
    notifDot.hidden = !notifPanel.querySelector('.notif-item.unread');
}

notifPanel.addEventListener('click', e => {
    const item = e.target.closest('.notif-item');
    if (item) {
        item.classList.remove('unread');
        refreshNotifDot();
    }
});

document.getElementById('notif-clear').addEventListener('click', () => {
    notifPanel.querySelectorAll('.notif-item.unread').forEach(i => i.classList.remove('unread'));
    refreshNotifDot();
});

// ---------- Log out ----------
document.getElementById('logout-btn').addEventListener('click', logout);

// ---------- Start: must be signed in, then load the leases ----------
requireLogin().then(loadLeases);