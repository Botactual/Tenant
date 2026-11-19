import { auth } from "../shared/firebase.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { setupPasswordToggles, authErrorText } from "./ui.js";

const NEXT_PAGE = "home.html";   // change this when the tenant dashboard exists

const form = document.getElementById("signup-form");
const message = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");
const googleBtn = document.getElementById("google-btn");

setupPasswordToggles();

// Locks the buttons while a request is running
function setBusy(busy) {
  submitBtn.disabled = busy;
  googleBtn.disabled = busy;
  submitBtn.textContent = busy ? "PLEASE WAIT…" : "CREATE ACCOUNT";
}

// Email + password
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm-password").value;

  if (password.length < 6) {
    message.textContent = "Password should be at least 6 characters.";
    return;
  }
  if (password !== confirm) {
    message.textContent = "Passwords do not match.";
    return;
  }

  setBusy(true);
  try {
    await createUserWithEmailAndPassword(auth, email, password);
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