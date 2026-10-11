const checkoutForm = document.querySelector("#checkout-form");
const fromInput = document.querySelector("#checkout-from");
const toInput = document.querySelector("#checkout-to");
const locationSelect = document.querySelector("#checkout-location");
const checkoutError = document.querySelector("#checkout-error");
const checkoutErrorBack = document.querySelector("#checkout-error-back");
const submitButton = document.querySelector("#checkout-submit");
const reviewButton = document.querySelector("#checkout-review-button");
const reviewSection = document.querySelector("#checkout-review");
const detailsSection = document.querySelector("#checkout-details");
const detailsToggle = document.querySelector("#checkout-details-toggle");
const detailsSummary = document.querySelector("#checkout-details-summary");
const confirmCheckbox = document.querySelector("#checkout-confirm");
const query = new URLSearchParams(window.location.search);
let storedCarId = "";
try {
  storedCarId = sessionStorage.getItem("lux:selected-car-id") || "";
} catch {
  // URL parameters remain the primary selection source.
}
const urlCarId = query.get("carId") || query.get("vehicleId") || "";
const carId = /^[1-9]\d*$/.test(urlCarId) ? urlCarId : storedCarId;
let selectedCar = null;

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function showError(message) {
  checkoutError.textContent = message;
  checkoutError.hidden = false;
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function showReview() {
  if (!checkoutForm.reportValidity() || !selectedCar) return;
  const days = Math.round((new Date(`${toInput.value}T00:00:00Z`) - new Date(`${fromInput.value}T00:00:00Z`)) / 86_400_000);
  document.querySelector("#review-car").textContent = `${selectedCar.make} ${selectedCar.model}`;
  document.querySelector("#review-from").textContent = displayDate(fromInput.value);
  document.querySelector("#review-to").textContent = displayDate(toInput.value);
  document.querySelector("#review-location").textContent = locationSelect.value;
  document.querySelector("#review-days").textContent = `${days} ${days === 1 ? "day" : "days"}`;
  document.querySelector("#review-total").textContent = money(days * Number(selectedCar.pricePerDay));
  detailsSummary.textContent = `${displayDate(fromInput.value)} – ${displayDate(toInput.value)} · ${locationSelect.value}`;
  detailsSummary.hidden = false;
  detailsSection.classList.add("is-collapsed");
  detailsToggle.setAttribute("aria-expanded", "false");
  reviewSection.hidden = false;
  reviewButton.hidden = true;
  submitButton.hidden = false;
  confirmCheckbox.checked = false;
  reviewSection.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelector("#checkout-review-title").focus({ preventScroll: true });
}

function transitionTo(url) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.location.assign(url);
    return;
  }
  document.body.classList.add("page-transition-out");
  window.setTimeout(() => window.location.assign(url), 180);
}

function updateDates() {
  const earliest = new Date(`${fromInput.value}T00:00:00`);
  earliest.setDate(earliest.getDate() + 1);
  toInput.min = localDate(earliest);
  if (!toInput.value || toInput.value < toInput.min) toInput.value = toInput.min;
  updateSummary();
}

function updateSummary() {
  if (!selectedCar) return;
  const from = new Date(`${fromInput.value}T00:00:00`);
  const to = new Date(`${toInput.value}T00:00:00`);
  const days = Math.round((to - from) / 86_400_000);
  document.querySelector("#summary-days-label").textContent = "Rental duration";
  document.querySelector("#summary-days").textContent = days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : "Choose dates";
  document.querySelector("#summary-total").textContent = days > 0 ? money(days * Number(selectedCar.pricePerDay)) : "—";
}

async function loadSelection() {
  if (!/^[1-9]\d*$/.test(carId)) {
    showError("This checkout link has no selected vehicle. Return to the collection and choose “Select this car” on a vehicle card.");
    checkoutErrorBack.hidden = false;
    submitButton.disabled = true;
    return;
  }
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
    selectedCar = result.car;
    try {
      sessionStorage.removeItem("lux:selected-car-id");
    } catch {
      // Storage is only a fallback for links without a carId query parameter.
    }
    const selectedName = `${selectedCar.make} ${selectedCar.model}`;
    document.querySelector("#checkout-car-name").textContent = `${selectedName}.`;
    document.title = `${selectedName} | Lux Collection`;
    const image = document.createElement("img");
    const imageWrap = document.querySelector("#summary-car");
    image.src = selectedCar.image;
    image.alt = `${selectedCar.make} ${selectedCar.model}`;
    image.onerror = () => {
      const fallback = document.createElement("div");
      fallback.className = "summary-placeholder";
      fallback.setAttribute("aria-hidden", "true");
      fallback.textContent = "L";
      imageWrap.replaceChildren(fallback);
    };
    imageWrap.replaceChildren(image);
    document.querySelector("#summary-make").textContent = `${selectedCar.make} · ${selectedCar.category.join(" / ")}`;
    document.querySelector("#summary-title").textContent = selectedCar.model;
    document.querySelector("#summary-specs").textContent = `${selectedCar.seats} seats · ${selectedCar.transmission} · ${selectedCar.category.join(" / ")}`;
    document.querySelector("#summary-rate").textContent = `${money(selectedCar.pricePerDay)} / day`;
    locationSelect.replaceChildren(...selectedCar.serviceAreas.map((area) => {
      const option = document.createElement("option");
      option.value = area;
      option.textContent = area;
      return option;
    }));
    if (selectedCar.serviceAreas.includes(query.get("location"))) locationSelect.value = query.get("location");
    submitButton.disabled = false;
    reviewButton.disabled = false;
    updateSummary();
  } catch (error) {
    showError(error.message || "We could not load this vehicle. Please return to the collection and try again.");
  }
}

const today = new Date();
fromInput.min = localDate(today);
fromInput.value = /^\d{4}-\d{2}-\d{2}$/.test(query.get("from") || "") ? query.get("from") : localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
toInput.value = /^\d{4}-\d{2}-\d{2}$/.test(query.get("to") || "") ? query.get("to") : "";
updateDates();
fromInput.addEventListener("change", updateDates);
toInput.addEventListener("change", updateSummary);

reviewButton.addEventListener("click", () => {
  checkoutError.hidden = true;
  showReview();
});

document.querySelector("#checkout-edit").addEventListener("click", () => {
  reviewSection.hidden = true;
  detailsSection.classList.remove("is-collapsed");
  detailsSummary.hidden = true;
  detailsToggle.setAttribute("aria-expanded", "true");
  submitButton.hidden = true;
  reviewButton.hidden = false;
  confirmCheckbox.checked = false;
  fromInput.focus();
});

detailsToggle.addEventListener("click", () => {
  if (reviewSection.hidden) return;
  reviewSection.hidden = true;
  detailsSection.classList.remove("is-collapsed");
  detailsSummary.hidden = true;
  detailsToggle.setAttribute("aria-expanded", "true");
  submitButton.hidden = true;
  reviewButton.hidden = false;
  confirmCheckbox.checked = false;
  detailsToggle.scrollIntoView({ behavior: "smooth", block: "center" });
});

submitButton.addEventListener("click", () => {
  checkoutError.hidden = true;
  if (!selectedCar || reviewSection.hidden) return;
  if (!confirmCheckbox.checked) {
    showError("Please confirm the reservation details before continuing.");
    confirmCheckbox.focus();
    return;
  }
  const selectedCarId = String(selectedCar._id ?? selectedCar.id ?? carId);
  if (!/^[1-9]\d*$/.test(selectedCarId)) {
    showError("We lost the selected vehicle. Return to the collection and select it again.");
    return;
  }
  const params = new URLSearchParams({ carId: selectedCarId, from: fromInput.value, to: toInput.value, location: locationSelect.value });
  transitionTo(`/vehicle-options.html?${params}`);
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("We could not safely end your session. Please try again.");
    window.location.assign("/");
  } catch (error) {
    showError(error.message);
  }
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});
loadSelection();
