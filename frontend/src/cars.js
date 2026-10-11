const carsGrid = document.querySelector("#cars-grid");
const resultsCount = document.querySelector("#results-count");
const loadMoreButton = document.querySelector("#cars-load-more");
const catalogueMessage = document.querySelector("#catalogue-message");
const searchForm = document.querySelector("#search-form");
const searchFrom = document.querySelector("#search-from");
const searchTo = document.querySelector("#search-to");
const activeFilters = [...document.querySelectorAll(".filter-button")];
const sortControl = document.querySelector("#catalogue-sort");
const today = new Date();
const pageSize = 24;
let filteredCars = [];
let shownCars = pageSize;

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function setMessage(message, isError = false) {
  catalogueMessage.textContent = message;
  catalogueMessage.classList.toggle("is-error", isError);
  catalogueMessage.hidden = !message;
}

function selectedCategory() {
  return document.querySelector(".filter-button.is-active").dataset.filter;
}

function checkoutUrl(car) {
  const selectedId = String(car._id ?? car.id ?? car.carId ?? "");
  const params = new URLSearchParams({
    carId: selectedId,
    from: searchFrom.value,
    to: searchTo.value,
    location: searchForm.elements.location.value,
  });
  return `/checkout.html?${params.toString()}`;
}

function renderCars(cars) {
  const category = selectedCategory();
  filteredCars = category === "all" ? cars : cars.filter((car) => car.category.includes(category));
  shownCars = pageSize;
  paintCars();
}

function paintCars() {
  const visibleCars = filteredCars.slice(0, shownCars);
  resultsCount.textContent = filteredCars.length > pageSize
    ? `Showing ${visibleCars.length} of ${filteredCars.length} cars for your next drive`
    : `${filteredCars.length} ${filteredCars.length === 1 ? "car" : "cars"} for your next drive`;
  loadMoreButton.hidden = visibleCars.length >= filteredCars.length;
  carsGrid.innerHTML = visibleCars.map((car) => `
    <article class="car-card member-car-card" data-checkout-href="${escapeHtml(checkoutUrl(car))}" role="link" tabindex="0" aria-label="Choose ${escapeHtml(`${car.make} ${car.model}`)}">
      <div class="car-image-link">
        <img src="${escapeHtml(car.image)}" alt="${escapeHtml(`${car.make} ${car.model}`)}" loading="lazy" />
      </div>
      <div class="car-card-content">
        <p class="car-make">${escapeHtml(car.make.toUpperCase())} | ${escapeHtml(car.category.join(" / ").toUpperCase())}</p>
        <h3>${escapeHtml(car.make)} ${escapeHtml(car.model)}</h3>
        <div class="car-meta"><span>${escapeHtml(String(car.seats))} seats</span><span>·</span><span>${escapeHtml(car.transmission)}</span></div>
        <div class="car-card-footer"><p><strong>£${escapeHtml(String(car.pricePerDay))}</strong><span> / day</span></p><a class="card-link reserve-car" data-car-id="${escapeHtml(String(car._id ?? car.id ?? car.carId ?? ""))}" href="${escapeHtml(checkoutUrl(car))}">Select this car <span aria-hidden="true">→</span></a></div>
      </div>
    </article>
  `).join("");
  if (filteredCars.length === 0) setMessage("No cars match that selection just yet. Try another category or date.");
  else setMessage("");
}

carsGrid.addEventListener("click", (event) => {
  const link = event.target.closest(".reserve-car[data-car-id]");
  if (link && /^[1-9]\d*$/.test(link.dataset.carId)) {
    try {
      sessionStorage.setItem("lux:selected-car-id", link.dataset.carId);
    } catch {
      // The car ID remains in the link itself if browser storage is unavailable.
    }
  }
  if (event.defaultPrevented || event.target.closest("a, button, input, select, textarea")) return;
  const card = event.target.closest(".member-car-card[data-checkout-href]");
  if (card) window.location.assign(card.dataset.checkoutHref);
});

carsGrid.addEventListener("keydown", (event) => {
  if (!event.target.matches(".member-car-card[data-checkout-href]") || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  window.location.assign(event.target.dataset.checkoutHref);
});

loadMoreButton.addEventListener("click", () => {
  shownCars += pageSize;
  paintCars();
});

async function loadCars() {
  setMessage("Finding the right cars for your dates...");
  resultsCount.textContent = "";
  const params = new URLSearchParams({
    from: searchFrom.value,
    to: searchTo.value,
    location: searchForm.elements.location.value,
    sort: sortControl.value,
  });
  const query = searchForm.elements.q.value.trim();
  if (query) params.set("q", query);

  try {
    const response = await fetch(`/api/cars?${params}`, { credentials: "same-origin" });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/login.html?next=/cars.html");
      return;
    }
    if (response.status === 403) {
      window.location.replace("/profile.html");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Cars could not be loaded. Please try again.");
    renderCars(result.cars);
  } catch (error) {
    setMessage(error.message || "We could not reach Lux Collection. Please check your connection and try again.", true);
    resultsCount.textContent = "";
  }
}

function updateReturnDateMin() {
  const earliest = new Date(`${searchFrom.value}T00:00:00`);
  earliest.setDate(earliest.getDate() + 1);
  searchTo.min = localDate(earliest);
  if (!searchTo.value || searchTo.value < searchTo.min) searchTo.value = searchTo.min;
}

searchFrom.min = localDate(today);
searchFrom.value = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
updateReturnDateMin();
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (searchForm.reportValidity()) loadCars();
});
searchFrom.addEventListener("change", updateReturnDateMin);
sortControl.addEventListener("change", loadCars);

activeFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilters.forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle("is-active", active);
      filter.setAttribute("aria-pressed", String(active));
    });
    loadCars();
  });
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("We could not safely end your session. Please try again.");
    window.location.assign("/");
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function loadMember() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (response.status === 401) {
      window.location.replace("/login.html?next=/cars.html");
      return;
    }
    if (!response.ok) throw new Error("Your account could not be loaded.");
    const { user } = await response.json();
    if (!user) {
      window.location.replace("/login.html?next=/cars.html");
      return;
    }
    if (!user.profileComplete) {
      window.location.replace("/profile.html");
      return;
    }
  } catch (error) {
    setMessage(error.message || "Your account could not be loaded.", true);
  }
}

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});
loadMember();
loadCars();
