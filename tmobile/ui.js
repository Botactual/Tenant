// Small helpers shared by the tenant login and signup pages.

// Wires every eye button to show/hide the password field next to it
export function setupPasswordToggles() {
  document.querySelectorAll(".toggle-password").forEach((btn) => {
    const input = btn.parentElement.querySelector("input");
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("is-on", show);
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

// Simple centered popup with an OK button
export function showPopup(title, text) {
  const overlay = document.createElement("div");
  overlay.className = "popup-overlay";

  const box = document.createElement("div");
  box.className = "auth-card popup-box";

  const h = document.createElement("h1");
  h.className = "popup-title";
  h.textContent = title;

  const p = document.createElement("p");
  p.className = "popup-text";
  p.textContent = text;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "auth-submit-btn";
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

// Turns Firebase error codes into plain sentences. Returns "" for errors to ignore.
export function authErrorText(err) {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/email-already-in-use":
      return "That email already has an account. Try logging in instead.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/invalid-email":
      return "That email address doesn't look valid.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google window. Allow pop-ups and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    default:
      return err.message || "Something went wrong. Please try again.";
  }
}