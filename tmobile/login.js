import { auth } from "../shared/firebase.js";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { setupPasswordToggles, showPopup, authErrorText } from "./ui.js";

const NEXT_PAGE = "home.html";   // change this when the tenant dashboard exists

const form = document.getElementById("login-form");
const message = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");
const googleBtn = document.getElementById("google-btn");

setupPasswordToggles();

// Locks the buttons while a request is running
function setBusy(busy) {
  submitBtn.disabled = busy;
  googleBtn.disabled = busy;
  submitBtn.textContent = busy ? "PLEASE WAIT…" : "LOGIN";
}

// Email + password
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  setBusy(true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = NEXT_PAGE;
  } catch (err) {
    message.textContent = authErrorText(err);
    setBusy(false);
  }
});

// Google
googleBtn.addEventListener("click", async () => {
  message.textContent = "";
  setBusy(true);
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    window.location.href = NEXT_PAGE;
  } catch (err) {
    message.textContent = authErrorText(err);
    setBusy(false);
  }
});

// Forgot password
document.getElementById("forgot-link").addEventListener("click", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value.trim();
  if (!email) {
    showPopup("Enter your email", "Type your email in the Email box first, then tap Forgot Password.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showPopup("Check your email", "A password reset link has been sent to " + email + ". Check your inbox and spam folder.");
  } catch (err) {
    if (err.code === "auth/invalid-email") {
      showPopup("Invalid email", "That email address doesn't look valid.");
    } else {
      showPopup("Something went wrong", authErrorText(err) || err.message);
    }
  }
});