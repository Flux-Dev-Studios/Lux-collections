const form = document.querySelector("#auth-form");
const errorMessage = document.querySelector("#form-error");
const submitButton = form.querySelector('[type="submit"]');
const submitLabel = submitButton.innerHTML;

function showFormError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function nextPage(user, requestedPage) {
  const allowedPages = ["/cars.html", "/checkout.html", "/profile.html", "/my-bookings.html", "/operator.html"];
  let safeDestination = "";
  if (requestedPage) {
    try {
      const destination = new URL(requestedPage, window.location.origin);
      if (destination.origin === window.location.origin && allowedPages.includes(destination.pathname)) {
        safeDestination = `${destination.pathname}${destination.search}`;
      }
    } catch {
      // Ignore malformed next-page values and use the member collection.
    }
  }
  if (!user.profileComplete) return safeDestination && safeDestination !== "/profile.html"
    ? `/profile.html?next=${encodeURIComponent(safeDestination)}` : "/profile.html";
  if (["operator", "admin"].includes(user.role)) return safeDestination === "/operator.html" ? safeDestination : "/operator.html";
  if (safeDestination && !safeDestination.startsWith("/operator.html")) return safeDestination;
  return "/cars.html";
}

function transitionTo(destination) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.location.assign(destination);
    return;
  }
  document.body.classList.add("auth-transitioning");
  window.setTimeout(() => window.location.assign(destination), 150);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = form.dataset.mode === "login" ? "Signing you in…" : "Creating your account…";
  let navigating = false;

  try {
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch(`/api/auth/${form.dataset.mode}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      showFormError(result.error || "We couldn’t complete that request. Please check your details.");
      return;
    }
    const requestedPage = new URLSearchParams(window.location.search).get("next") || result.next;
    navigating = true;
    submitButton.textContent = "Opening your collection…";
    transitionTo(nextPage(result.user, requestedPage));
  } catch {
    showFormError("We couldn’t reach Lux Collection. Please check your connection and try again.");
  } finally {
    if (!navigating) {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitButton.innerHTML = submitLabel;
    }
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

const requestedPage = new URLSearchParams(window.location.search).get("next");
fetch("/api/auth/me", { credentials: "same-origin" })
  .then(async (response) => {
    if (response.status === 401) return;
    if (!response.ok) throw new Error("Account status could not be checked.");
    const { user } = await response.json();
    if (!user) return;
    transitionTo(nextPage(user, requestedPage));
  })
  .catch((error) => {
    showFormError(error.message);
  });

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});
