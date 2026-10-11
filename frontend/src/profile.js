const profileForm = document.querySelector("#profile-form");
const profileError = document.querySelector("#form-error");
const profileSubmit = document.querySelector("#profile-submit");
const progress = document.querySelector("#profile-progress");
const progressLabel = document.querySelector("#progress-label");
const profileStatus = document.querySelector("#profile-save-status");
let firstProfileSetup = true;

function postProfileDestination(user) {
  const requested = new URLSearchParams(window.location.search).get("next") || "";
  const allowedPages = ["/cars.html", "/checkout.html", "/my-bookings.html", "/operator.html"];
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin === window.location.origin && allowedPages.includes(destination.pathname)) {
      if (destination.pathname === "/operator.html" && !["operator", "admin"].includes(user.role)) return "/cars.html";
      return `${destination.pathname}${destination.search}`;
    }
  } catch { /* Use the normal member landing page for an invalid destination. */ }
  return ["operator", "admin"].includes(user.role) ? "/operator.html" : "/cars.html";
}

function showProfileError(message) {
  profileError.textContent = message;
  profileError.hidden = false;
}

function initials(fullName) {
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "L";
}

function renderProgress() {
  const fields = [...profileForm.querySelectorAll('input:not([type="hidden"])')];
  const completed = fields.filter((field) => field.value.trim().length > 0).length;
  progress.value = Math.round((completed / fields.length) * 100);
  progressLabel.textContent = completed === fields.length ? "Ready to go" : `${fields.length - completed} details to go`;
}

profileForm.addEventListener("input", () => {
  profileStatus.textContent = "";
  renderProgress();
});
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileError.hidden = true;
  profileSubmit.disabled = true;
  profileSubmit.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("/api/auth/profile", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(profileForm))),
    });
    const result = await response.json();
    if (!response.ok) {
      showProfileError(result.error || "We couldn't save your profile. Please check the details and try again.");
      return;
    }
    if (firstProfileSetup) {
      const destination = postProfileDestination(result.user);
      document.body.classList.add("auth-transitioning");
      window.setTimeout(() => window.location.assign(destination), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150);
      return;
    }
    document.querySelector("#profile-avatar").textContent = initials(profileForm.elements.fullName.value);
    profileStatus.textContent = "Your changes have been saved.";
  } catch {
    showProfileError("We couldn't reach Lux Collection. Please check your connection and try again.");
  } finally {
    profileSubmit.disabled = false;
    profileSubmit.removeAttribute("aria-busy");
  }
});

async function loadProfile() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }
    if (!response.ok) throw new Error("Your profile couldn't be loaded. Please refresh and try again.");
    const { user } = await response.json();
    if (!user) {
      window.location.replace("/login.html?next=/profile.html");
      return;
    }
    document.querySelector("#profile-email").textContent = user.email;
    profileForm.elements.fullName.value = user.profile.fullName;
    profileForm.elements.phone.value = user.profile.phone;
    profileForm.elements.city.value = user.profile.city;
    document.querySelector("#profile-avatar").textContent = initials(user.profile.fullName);
    if (user.profileComplete) {
      firstProfileSetup = false;
      document.body.classList.remove("profile-onboarding");
      document.body.classList.add("profile-complete", "site-nav-page");
      const panel = document.querySelector("#profile-panel");
      panel.setAttribute("role", "region");
      panel.removeAttribute("aria-modal");
      document.querySelector("#profile-title").innerHTML = 'Your <span>profile.</span>';
      document.querySelector("#profile-subtitle").textContent = "Manage the details we use to personalise your reservations.";
      profileSubmit.innerHTML = 'Save profile changes <span aria-hidden="true">&#8594;</span>';
    } else {
      requestAnimationFrame(() => profileForm.elements.fullName.focus());
    }
    renderProgress();
  } catch (error) {
    showProfileError(error.message);
  }
}

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("We couldn't safely end your session. Please try again.");
    window.location.assign("/");
  } catch (error) {
    showProfileError(error.message);
  }
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

loadProfile();
