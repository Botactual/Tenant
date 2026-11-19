// Shared Firebase setup: sign-in check, logout, and Data Connect (database) calls.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDataConnect,
  executeQuery,
  executeMutation,
  queryRef,
  mutationRef,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-data-connect.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPquKkCNwtEOo9ehAK9TLq_K-_JgsDD8A",
  authDomain: "dashboard-572f3.firebaseapp.com",
  projectId: "dashboard-572f3",
  appId: "1:1074021870720:web:70522d384dc6ee27da8a65",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const dc = getDataConnect(app, {
  connector: "example",
  service: "dashboard-572f3-service",
  location: "asia-east1",
});

// ---------- Auth ----------
// Resolves with the signed-in user, or sends the visitor to the login page.
export function requireLogin() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      if (!user) {
        window.location.href = "../auth/login.html";
        return;
      }
      resolve(user);
    });
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = "../auth/login.html";
}

// ---------- Helpers ----------
// The unit number is stored at the start of the property name ("Unit 01" or "Unit 01 – Sunrise").
// Works with anything that has a property (a lease, a maintenance request) or a property itself.
export function unitOf(item) {
  const name = item?.property?.name ?? item?.name ?? "";
  const m = /^Unit\s+(\d+)/i.exec(name);
  return m ? m[1].padStart(2, "0") : "--";
}

// ---------- Reads ----------
export async function listLeases() {
  const res = await executeQuery(queryRef(dc, "ListLeases"));
  return res.data.leases;
}

export async function listMaintenance() {
  const res = await executeQuery(queryRef(dc, "ListMaintenanceRequests"));
  return res.data.maintenanceRequests;
}

export async function listPayments() {
  const res = await executeQuery(queryRef(dc, "ListPayments"));
  return res.data.payments;
}

// ---------- Writes ----------
// Creates the property, the tenant, then the lease that links them.
export async function addTenantWithLease({ property, tenant, lease }) {
  const p = await executeMutation(mutationRef(dc, "CreateProperty", property));
  const t = await executeMutation(mutationRef(dc, "CreateTenant", tenant));
  await executeMutation(
    mutationRef(dc, "CreateLease", {
      ...lease,
      propertyId: p.data.property_insert.id,
      tenantId: t.data.tenant_insert.id,
    })
  );
}

// Saves a payment against a lease (status is always "paid" when recorded by hand).
export async function recordPayment({ leaseId, amount, paymentDate, paymentMethod, transactionReference }) {
  const opt = (key, value) => (value === "" || value == null ? {} : { [key]: value });
  await executeMutation(
    mutationRef(dc, "CreatePayment", {
      leaseId,
      amount,
      paymentDate,
      status: "paid",
      ...opt("paymentMethod", paymentMethod),
      ...opt("transactionReference", transactionReference),
    })
  );
}