import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPquKkCNwtEOo9ehAK9TLq_K-_JgsDD8A",
  authDomain: "dashboard-572f3.firebaseapp.com",
  projectId: "dashboard-572f3",
  appId: "1:1074021870720:web:70522d384dc6ee27da8a65",
};

const auth = getAuth(initializeApp(firebaseConfig));

const form = document.querySelector(".login-form");
const submitBtn = form.querySelector(".signup-btn");

const message = document.createElement("p");
message.style.cssText = "color:#c00; font-size:13px; margin:0 0 10px;";
form.insertBefore(message, submitBtn);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm-password").value;

  if (password !== confirm) {
    message.textContent = "Passwords do not match.";
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    window.location.href = "../dashboard/dashboard.html";
  } catch (err) {
    message.textContent = err.message;
  }
});

// Google signup
document.querySelector(".google-btn").addEventListener("click", async () => {
  message.textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    window.location.href = "../dashboard/dashboard.html";
  } catch (err) {
    message.textContent = err.message;
  }
});