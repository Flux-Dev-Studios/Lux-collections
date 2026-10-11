const form = document.querySelector("#recovery-form");
const errorMessage = document.querySelector("#form-error");
const successMessage = document.querySelector("#form-success");
const submitButton = form.querySelector('[type="submit"]');
const token = new URLSearchParams(window.location.search).get("token") || "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  successMessage.hidden = true;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");

  try {
    const data = Object.fromEntries(new FormData(form));
    const request = form.dataset.mode === "request";
    const response = await fetch(`/api/auth/password-reset/${request ? "request" : "complete"}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request ? data : { token, ...data }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn’t complete that request. Please try again.");
    successMessage.textContent = result.message;
    successMessage.hidden = false;
    if (!request) {
      form.elements.password.disabled = true;
      submitButton.hidden = true;
    }
  } catch (error) {
    errorMessage.textContent = error.message || "We couldn’t reach Lux Collection. Please check your connection and try again.";
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "Hide" : "Show";
    button.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} password`);
    button.setAttribute("aria-pressed", String(reveal));
    input.focus();
  });
});

if (form.dataset.mode === "complete" && !/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
  errorMessage.textContent = "This reset link is invalid or has expired. Request a new link to continue.";
  errorMessage.hidden = false;
  form.elements.password.disabled = true;
  submitButton.disabled = true;
}

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});
