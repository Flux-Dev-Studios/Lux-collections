const params = new URLSearchParams(window.location.search);
const carId = params.get("carId") || "";
const from = params.get("from") || "";
const to = params.get("to") || "";
const locationName = params.get("location") || "";
const form = document.querySelector("#options-form");
const grid = document.querySelector("#options-grid");
const submit = document.querySelector("#options-submit");
const error = document.querySelector("#options-error");
const submitError = document.querySelector("#options-submit-error");
let vehicle = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function displayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function setError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function renderDetails(label, values) {
  const entries = Object.entries(values || {}).filter(([, value]) => value !== undefined && value !== "");
  if (!entries.length) return "";
  return `<span class="vehicle-option-specs">${entries.map(([key, value]) => `<span><strong>${escapeHtml(key)}</strong>${escapeHtml(value)}</span>`).join("")}</span>`;
}

function renderOption(option, index, isBase = false) {
  const id = isBase ? "base" : option.id;
  const name = isBase ? "Current listing" : option.name;
  const design = isBase ? "Published vehicle specification" : option.design;
  const price = isBase ? vehicle.pricePerDay : option.pricePerDay;
  const description = isBase ? vehicle.description : option.description;
  const detailContent = isBase
    ? renderDetails("Specifications", { Seats: vehicle.seats, Transmission: vehicle.transmission, Category: vehicle.category.join(" / ") })
    : `${renderDetails("Performance", option.performance)}${renderDetails("Specifications", option.specs)}`;
  const features = !isBase && Array.isArray(option.features) && option.features.length
    ? `<span class="vehicle-option-features">${option.features.map((feature) => `<span>${escapeHtml(feature)}</span>`).join("")}</span>`
    : "";
  return `<label class="vehicle-option">
    <input type="radio" name="variantId" value="${escapeHtml(id)}" ${index === 0 ? "checked" : ""} />
    <span class="vehicle-option-content"><span class="vehicle-option-title"><strong>${escapeHtml(name)}</strong><span>${money(price)} / day</span></span>
    <span class="vehicle-option-design">${escapeHtml(design)}</span>
    ${description ? `<span class="vehicle-option-description">${escapeHtml(description)}</span>` : ""}
    ${detailContent}${features}</span>
  </label>`;
}

async function loadVehicle() {
  if (!/^[1-9]\d*$/.test(carId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !locationName) {
    setError(error, "Your reservation details are incomplete. Return to the collection and start again.");
    return;
  }
  const back = new URLSearchParams({ carId, from, to, location: locationName });
  document.querySelector("#options-back").href = `/checkout.html?${new URLSearchParams({ carId, from, to, location: locationName })}`;
  document.querySelector("#options-edit-dates").href = `/checkout.html?${back}`;
  try {
    const response = await fetch(`/api/cars/${encodeURIComponent(carId)}`, { credentials: "same-origin" });
    const result = await response.json();
    if (response.status === 401) {
      window.location.assign(`/login.html?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    if (response.status === 403) {
      window.location.assign("/profile.html");
      return;
    }
    if (!response.ok) throw new Error(result.error || "This vehicle is no longer available.");
    vehicle = result.car;
    document.title = `Choose a ${vehicle.make} ${vehicle.model} version | Lux Collection`;
    document.querySelector("#options-make").textContent = `${vehicle.make} · ${vehicle.category.join(" / ")}`;
    document.querySelector("#options-car-name").textContent = `${vehicle.make} ${vehicle.model}`;
    document.querySelector("#options-description").textContent = vehicle.description;
    document.querySelector("#options-dates").textContent = `${displayDate(from)} – ${displayDate(to)}`;
    document.querySelector("#options-location").textContent = locationName;
    const image = document.createElement("img");
    image.src = vehicle.image;
    image.alt = `${vehicle.make} ${vehicle.model}`;
    image.onerror = () => image.remove();
    document.querySelector("#options-image").replaceChildren(image);
    const variants = Array.isArray(vehicle.variants) ? vehicle.variants : [];
    document.querySelector("#options-empty").hidden = variants.length > 0;
    grid.innerHTML = variants.length
      ? variants.map((variant, index) => renderOption(variant, index)).join("")
      : renderOption({}, 0, true);
    submit.disabled = false;
  } catch (requestError) {
    setError(error, requestError.message || "We could not load this vehicle. Please return to the collection and try again.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(submitError, "");
  if (!vehicle) return;
  const selectedVariant = form.elements.variantId.value || "base";
  submit.disabled = true;
  submit.textContent = "Sending your request…";
  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carId, from, to, location: locationName, variantId: selectedVariant }),
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.assign(`/login.html?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    if (response.status === 403) {
      window.location.assign("/profile.html");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your request could not be submitted.");
    try { sessionStorage.setItem("lux:last-reservation", JSON.stringify(result.booking)); } catch { /* Confirmation can load it from the account later. */ }
    window.location.assign(`/reservation-confirmation.html?bookingId=${encodeURIComponent(result.booking._id)}`);
  } catch (requestError) {
    setError(submitError, requestError.message || "We could not send your request. Please try again.");
    submit.disabled = false;
    submit.innerHTML = 'Send reservation request <span aria-hidden="true">→</span>';
  }
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (response.ok) window.location.assign("/");
  else setError(submitError, "We could not safely end your session. Please try again.");
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

loadVehicle();
