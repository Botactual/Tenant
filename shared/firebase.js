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
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPquKkCNwtEOo9ehAK9TLq_K-_JgsDD8A",
  authDomain: "dashboard-572f3.firebaseapp.com",
  projectId: "dashboard-572f3",
  appId: "1:1074021870720:web:70522d384dc6ee27da8a65",
  // Check this on Firebase console > Build > Storage. Older projects use "dashboard-572f3.appspot.com".
  storageBucket: "dashboard-572f3.firebasestorage.app",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const storage = getStorage(app);

// Limits for photos/videos attached to a request (storage.rules enforces the size too)
export const MAX_ATTACH_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACH_FILES = 5;

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

export async function listMaintenanceAttachments() {
  const res = await executeQuery(queryRef(dc, "ListMaintenanceAttachments"));
  return res.data.maintenanceAttachments;
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

// Dashboard > tenant details > Edit. Each object must include the row's own `id`.
// A field that is left out stays as it is; a field sent as null is cleared (optional columns only).
export async function updateTenantAndLease({ property, tenant, lease }) {
  await executeMutation(mutationRef(dc, "UpdateProperty", property));
  await executeMutation(mutationRef(dc, "UpdateTenant", tenant));
  await executeMutation(mutationRef(dc, "UpdateLease", lease));
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


// Tenant portal: sends a new maintenance request for a property. Returns the new request's id.
export async function createMaintenanceRequest({ title, description, priorityLevel, propertyId }) {
  const res = await executeMutation(
    mutationRef(dc, "CreateMaintenanceRequest", {
      title,
      description,
      status: "open",
      propertyId,
      ...(priorityLevel ? { priorityLevel } : {}),
    })
  );
  return res.data.maintenanceRequest_insert.id;
}

// Uploads one photo/video to Firebase Storage.
// onProgress gets a number from 0 to 1. Resolves with the details to save in the database.
export function uploadMaintenanceFile(file, propertyId, onProgress) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `maintenance/${propertyId}/${Date.now()}-${rand}-${safeName}`;
  const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => { if (onProgress && snap.totalBytes) onProgress(snap.bytesTransferred / snap.totalBytes); },
      reject,
      async () => {
        try {
          const fileUrl = await getDownloadURL(task.snapshot.ref);
          resolve({ fileName: file.name, fileUrl, contentType: file.type, sizeBytes: file.size });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

// Links already-uploaded files to a request.
export async function addMaintenanceAttachments(requestId, list) {
  for (const a of list) {
    await executeMutation(
      mutationRef(dc, "CreateMaintenanceAttachment", {
        requestId,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })
    );
  }
}

const CLOUDINARY_CLOUD  = "snepjcae";
const CLOUDINARY_PRESET = "tenconnect";