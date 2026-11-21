import { auth, requireLogin, logout, listLeases, listPayments, unitOf } from '../shared/firebase.js';
import {
    updateProfile,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

lucide.createIcons();

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');

// Shows a green (ok) or red (error) line under a form. Empty text hides it.
function setMsg(id, text, ok = true) {
    const el = $(id);
    el.textContent = text;
    el.className = 'set-msg' + (text ? (ok ? ' ok' : ' error') : '');
}

// Disables a button and changes its label while an async job runs
async function busy(btn, label, job) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await job(); }
    finally { btn.disabled = false; btn.textContent = original; }
}

// ---------- Preferences (saved in this browser; payment.js reads the same key) ----------
const PREF_KEY = 'tenere.settings';
const DEFAULTS = { dueDay: 5, method: 'Cash' };

function loadPrefs() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
    catch { return { ...DEFAULTS }; }
}

function savePrefs(prefs) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); return true; }
    catch { return false; }   // storage blocked
}

function fillPrefs(prefs) {
    $('pref-due').value = prefs.dueDay;
    const radio = document.querySelector(`#pref-methods input[value="${prefs.method}"]`);
    if (radio) radio.checked = true;
}

// ---------- Start: must be signed in ----------
const user = await requireLogin();

$('set-email').textContent = user.email || '';
$('profile-email').value = user.email || '';
$('profile-name').value = user.displayName || '';
fillPrefs(loadPrefs());

// ---------- Profile ----------
$('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    setMsg('profile-msg', '');

    const name = $('profile-name').value.trim();
    if (!name) return setMsg('profile-msg', 'Enter a display name.', false);

    await busy($('profile-save'), 'Saving…', async () => {
        try {
            await updateProfile(auth.currentUser, { displayName: name });
            setMsg('profile-msg', 'Profile saved.');
        } catch (err) {
            console.error(err);
            setMsg('profile-msg', 'Could not save: ' + (err.message || err), false);
        }
    });
});

// ---------- Password ----------
// Google sign-in accounts have no password to change
const hasPassword = user.providerData.some(p => p.providerId === 'password');
if (!hasPassword) {
    $('password-form').hidden = true;
    $('pw-note').hidden = false;
    $('pw-note').textContent = 'You signed in with Google, so there is no password to change here. Manage it in your Google account.';
}

function passwordError(err) {
    switch (err.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
            return 'Your current password is wrong.';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a moment and try again.';
        case 'auth/network-request-failed':
            return 'No connection. Check your internet and try again.';
        default:
            return err.message || 'Something went wrong. Please try again.';
    }
}

$('password-form').addEventListener('submit', async e => {
    e.preventDefault();
    setMsg('password-msg', '');

    const current = $('pw-current').value;
    const next = $('pw-new').value;
    const confirm = $('pw-confirm').value;

    if (!current) return setMsg('password-msg', 'Enter your current password.', false);
    if (next.length < 6) return setMsg('password-msg', 'New password should be at least 6 characters.', false);
    if (next !== confirm) return setMsg('password-msg', 'New passwords do not match.', false);
    if (next === current) return setMsg('password-msg', 'Choose a different password from the current one.', false);

    await busy($('pw-save'), 'Saving…', async () => {
        try {
            // Firebase asks for a fresh sign-in before a password change
            const credential = EmailAuthProvider.credential(user.email, current);
            await reauthenticateWithCredential(auth.currentUser, credential);
            await updatePassword(auth.currentUser, next);
            $('password-form').reset();
            setMsg('password-msg', 'Password changed.');
        } catch (err) {
            console.error(err);
            setMsg('password-msg', passwordError(err), false);
        }
    });
});

// ---------- Preferences form ----------
$('pref-form').addEventListener('submit', e => {
    e.preventDefault();
    setMsg('pref-msg', '');

    const dueDay = Number($('pref-due').value);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
        return setMsg('pref-msg', 'Due day must be a whole number from 1 to 28.', false);
    }
    const picked = document.querySelector('#pref-methods input:checked');
    const method = picked ? picked.value : DEFAULTS.method;

    if (savePrefs({ dueDay, method })) setMsg('pref-msg', 'Preferences saved.');
    else setMsg('pref-msg', 'Could not save: this browser is blocking local storage.', false);
});

$('pref-reset').addEventListener('click', () => {
    fillPrefs(DEFAULTS);
    if (savePrefs({ ...DEFAULTS })) setMsg('pref-msg', 'Preferences reset to defaults.');
});

// ---------- Export all data (CSV) ----------
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const isoDay = v => String(v ?? '').slice(0, 10);
const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

$('export-btn').addEventListener('click', async () => {
    setMsg('export-msg', '');
    await busy($('export-btn'), 'Exporting…', async () => {
        try {
            const [leases, payments] = await Promise.all([listLeases(), listPayments()]);
            const byId = new Map(leases.map(l => [l.id, l]));
            const nameOf = l => (l ? `${l.tenant.firstName} ${l.tenant.lastName}` : '—');

            const rows = [
                ['Tenere data export', todayLocal()],
                [],
                ['Tenants and leases'],
                ['Unit', 'First name', 'Last name', 'Email', 'Phone', 'Monthly rent', 'Deposit', 'Lease start', 'Lease end', 'Archived'],
                ...[...leases]
                    .sort((a, b) => unitOf(a).localeCompare(unitOf(b)))
                    .map(l => [
                        unitOf(l), l.tenant.firstName, l.tenant.lastName, l.tenant.email, l.tenant.phoneNumber,
                        Number(l.monthlyRent), l.depositAmount ?? '', isoDay(l.startDate), isoDay(l.endDate),
                        l.tenant.isArchived ? 'Yes' : 'No',
                    ]),
                [],
                ['Payments'],
                ['Date', 'Unit', 'Tenant', 'Amount', 'Method', 'Reference', 'Status'],
                ...payments.map(p => {
                    const l = byId.get(p.lease?.id);
                    return [
                        isoDay(p.paymentDate), l ? unitOf(l) : '--', nameOf(l),
                        p.amount ?? l?.monthlyRent ?? '', p.paymentMethod || '', p.transactionReference || '', p.status,
                    ];
                }),
            ];

            const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `tenere-data-${todayLocal()}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            setMsg('export-msg', `Exported ${leases.length} lease(s) and ${payments.length} payment(s).`);
        } catch (err) {
            console.error(err);
            setMsg('export-msg', 'Could not export: ' + (err.message || err), false);
        }
    });
});

// ---------- Log out ----------
$('logout-btn').addEventListener('click', logout);
$('top-logout').addEventListener('click', logout);