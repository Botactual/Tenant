import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPquKkCNwtEOo9ehAK9TLq_K-_JgsDD8A",
  authDomain: "dashboard-572f3.firebaseapp.com",
  projectId: "dashboard-572f3",
  appId: "1:1074021870720:web:70522d384dc6ee27da8a65",
};

const auth = getAuth(initializeApp(firebaseConfig));
const NEXT_PAGE = "../dashboard/dashboard.html"; 

const form = document.querySelector(".login-form");
const submitBtn = form.querySelector(".login-submit-btn");


const message = document.createElement("p");
message.className = "form-message";
form.insertBefore(message, submitBtn);

// poopup
function showPopup(title, text) {
  const overlay = document.createElement("div");
  overlay.className = "popup-overlay";

  const box = document.createElement("div");
  box.className = "login-card popup-box";

  const h = document.createElement("h1");
  h.className = "login-title popup-title";
  h.textContent = title;

  const p = document.createElement("p");
  p.className = "popup-text";
  p.textContent = text;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "login-submit-btn";
  btn.textContent = "OK";

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  btn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  box.append(h, p, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  btn.focus();
}

// Email stuff
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = NEXT_PAGE;
  } catch (err) {
    message.textContent =
      err.code === "auth/invalid-credential"
        ? "Wrong email or password."
        : err.message;
  }
});

// Google shit
document.querySelector(".google-btn").addEventListener("click", async () => {
  message.textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    window.location.href = NEXT_PAGE;
  } catch (err) {
    message.textContent = err.message;
  }
});

// Forgot pass
document.querySelector(".forgot-password a").addEventListener("click", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value.trim();
  if (!email) {
    showPopup("Enter your email", "Type your email in the Email box first, then click Forgot Password.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showPopup("Check your email", "A password reset link has been sent to " + email + ". Check your inbox and spam folder.");
  } catch (err) {
    if (err.code === "auth/invalid-email") {
      showPopup("Invalid email", "That email address doesn't look valid.");
    } else {
      showPopup("Something went wrong", err.message);
    }
  }
});