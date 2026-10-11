const query = new URLSearchParams(window.location.search);
const bookingId = query.get("bookingId") || "";
const errorElement = document.querySelector("#confirmation-error");

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(normalized));
}

function renderBooking(booking) {
  const car = booking.car;
  const carName = car ? `${car.make} ${car.model}` : "Lux Collection vehicle";
  document.title = `Request for ${carName} received | Lux Collection`;
  document.querySelector("#confirmation-reference").textContent = `LC-${String(booking._id).padStart(6, "0")}`;
  document.querySelector("#confirmation-make").textContent = car ? `${car.make} · ${car.category.join(" / ")}` : "LUX COLLECTION";
  document.querySelector("#confirmation-car").textContent = car?.model || carName;
  document.querySelector("#confirmation-specs").textContent = car
    ? `${car.variant ? `${car.variant.name} · ` : ""}${car.category.join(" / ")} · ${money(booking.pricePerDay)} per day`
    : "Your selected vehicle";
  document.querySelector("#confirmation-dates").textContent = `${formatDate(booking.startDate)} – ${formatDate(booking.endDate)}`;
  document.querySelector("#confirmation-location").textContent = booking.pickupLocation;
  document.querySelector("#confirmation-duration").textContent = `${booking.days} ${booking.days === 1 ? "day" : "days"}`;
  document.querySelector("#confirmation-total").textContent = `${money(booking.totalPrice)} estimated`;
  document.querySelector("#confirmation-status").textContent = booking.status === "requested" ? "Under review" : booking.status;
  if (car?.image) {
    const image = document.createElement("img");
    image.src = car.image;
    image.alt = carName;
    image.onerror = () => image.remove();
    document.querySelector("#confirmation-image").replaceChildren(image);
  }
}

async function loadBooking() {
  if (!/^[1-9]\d*$/.test(bookingId)) {
    errorElement.textContent = "We couldn’t find a reservation reference. You can still review all your requests in My reservations.";
    errorElement.hidden = false;
    return;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem("lux:last-reservation") || "null");
    if (saved && saved._id === bookingId) {
      renderBooking(saved);
      return;
    }
  } catch {
    // Fall back to the authenticated reservation list if browser storage is unavailable.
  }
  try {
    const response = await fetch("/api/bookings", { credentials: "same-origin" });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace(`/login.html?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your reservation details could not be loaded.");
    const booking = result.bookings.find((item) => item._id === bookingId);
    if (!booking) throw new Error("We couldn’t find that reservation. Please check My reservations.");
    renderBooking(booking);
  } catch (error) {
    errorElement.textContent = error.message || "We could not load your reservation details.";
    errorElement.hidden = false;
  }
}

document.querySelector("[data-logout]").addEventListener("click", async () => {
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (response.ok) window.location.assign("/");
  else {
    errorElement.textContent = "We could not safely end your session. Please try again.";
    errorElement.hidden = false;
  }
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

loadBooking();
