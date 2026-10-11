const notice = document.querySelector("#notice");
const panels = [...document.querySelectorAll(".panel")];
const navButtons = [...document.querySelectorAll("[data-panel]")];
const titles = { overview: "Good morning", bookings: "Reservations", fleet: "Your fleet", customers: "Customers" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle("is-error", isError);
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const result = response.status === 204 ? {} : await response.json();
  if (response.status === 401) {
    window.location.assign("/login.html?next=/operator.html");
    throw new Error("Please sign in to continue.");
  }
  if (response.status === 403) throw new Error("Your account does not have operator access.");
  if (!response.ok) throw new Error(result.error || "That action could not be completed.");
  return result;
}

function setPanel(name) {
  panels.forEach((panel) => panel.classList.toggle("is-visible", panel.id === `panel-${name}`));
  navButtons.forEach((button) => {
    const active = button.dataset.panel === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#page-title").textContent = titles[name];
  history.replaceState(null, "", `#${name}`);
  if (name === "bookings") loadBookings();
  if (name === "fleet") loadFleet();
  if (name === "customers") loadCustomers();
}

navButtons.forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
document.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.goto)));
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

async function loadOverview() {
  const data = await api("/api/operator/dashboard");
  document.querySelector("#metric-fleet").textContent = data.fleet.total;
  document.querySelector("#metric-available").textContent = data.fleet.available;
  document.querySelector("#metric-review").textContent = data.reservations.awaiting_review;
  document.querySelector("#metric-active").textContent = data.reservations.active;
  document.querySelector("#metric-value").textContent = money(data.bookedValue);
  document.querySelector("#pending-count").textContent = data.reservations.awaiting_review;
  document.querySelector("#ready-count").textContent = `${data.fleet.available} / ${data.fleet.total}`;
  const ratio = data.fleet.total ? Math.round(data.fleet.available / data.fleet.total * 100) : 0;
  document.querySelector("#readiness-bar").style.width = `${ratio}%`;
  document.querySelector("#readiness-caption").textContent = `${ratio}% of the fleet ready · ${data.fleet.maintenance} in maintenance`;
  document.querySelector("#recent-table").innerHTML = data.recent.length ? data.recent.map((booking) => `<tr>
    <td><div class="guest-cell"><strong>${escapeHtml(booking.full_name)}</strong><small>Reservation #${escapeHtml(booking.id)}</small></div></td>
    <td>${escapeHtml(booking.make)} ${escapeHtml(booking.model)}</td>
    <td>${escapeHtml(booking.start_date)} <span class="sub-cell">→ ${escapeHtml(booking.end_date)}</span></td>
    <td>${money(booking.total_price)}</td><td><span class="status-pill status-${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></td></tr>`).join("") : '<tr><td colspan="5" class="empty-row">Reservations will appear here when customers book.</td></tr>';
}

const nextStatuses = { requested: ["confirmed", "rejected"], confirmed: ["active", "cancelled"], active: ["completed"], completed: [], cancelled: [], rejected: [] };

async function loadBookings() {
  try {
    const { bookings } = await api("/api/operator/bookings");
    document.querySelector("#booking-total").textContent = `${bookings.length} reservation${bookings.length === 1 ? "" : "s"}`;
    document.querySelector("#bookings-table").innerHTML = bookings.length ? bookings.map((booking) => {
      const options = nextStatuses[booking.status].map((status) => `<option value="${status}">${status[0].toUpperCase()}${status.slice(1)}</option>`).join("");
      const select = options ? `<select class="action-select" data-booking-id="${escapeHtml(booking.id)}"><option value="">Update status…</option>${options}</select>` : "";
      return `<tr><td><div class="guest-cell"><strong>${escapeHtml(booking.full_name)}</strong><small>${escapeHtml(booking.email)} · ${escapeHtml(booking.phone)}</small></div></td>
      <td>${escapeHtml(booking.make)} ${escapeHtml(booking.model)}${booking.variant_name ? `<div class="sub-cell">${escapeHtml(booking.variant_name)}${booking.variant_design ? ` Â· ${escapeHtml(booking.variant_design)}` : ""}</div>` : ""}<div class="sub-cell">${escapeHtml(booking.registration_number || "Fleet vehicle")}</div></td>
      <td>${escapeHtml(booking.start_date)} → ${escapeHtml(booking.end_date)}<div class="sub-cell">${escapeHtml(booking.pickup_location)} · ${booking.days} days</div></td>
      <td>${money(booking.total_price)}<div class="sub-cell">${money(Number(booking.paid_amount_cents || 0) / 100)} paid</div></td><td><span class="status-pill status-${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span>${select}</td></tr>`;
    }).join("") : '<tr><td colspan="5" class="empty-row">No reservations yet. New requests will appear here.</td></tr>';
  } catch (error) { showNotice(error.message, true); }
}

async function loadFleet() {
  try {
    const { cars } = await api("/api/operator/cars");
    document.querySelector("#fleet-total").textContent = `${cars.length} vehicles`;
    document.querySelector("#fleet-grid").innerHTML = cars.map((car) => {
      const fleetState = car.active ? car.fleet_status : "hidden";
      const searchable = `${car.make} ${car.model} ${car.registration_number || ""} ${car.location_label || ""} ${car.service_areas.join(" ")}`.toLowerCase();
      return `<article class="fleet-card" data-fleet-card="${escapeHtml(car.id)}" data-vehicle-search="${escapeHtml(searchable)}" data-vehicle-status="${escapeHtml(fleetState)}">
      <div class="fleet-card-top"><div><h3>${escapeHtml(car.make)} ${escapeHtml(car.model)}</h3><p>${escapeHtml(car.registration_number || "Registration not set")} · ${escapeHtml(car.location_label || car.service_areas.join(", "))}</p></div><span class="status-pill status-${car.active ? escapeHtml(car.fleet_status) : "cancelled"}">${car.active ? escapeHtml(car.fleet_status) : "hidden"}</span></div>
      <div class="fleet-specs"><span>${escapeHtml(car.seats)} seats · ${escapeHtml(car.transmission)}</span><strong>${money(car.price_per_day)} / day</strong></div>
      <div class="fleet-controls"><label>Fleet status<select name="fleetStatus"><option value="available" ${car.fleet_status === "available" ? "selected" : ""}>Available</option><option value="maintenance" ${car.fleet_status === "maintenance" ? "selected" : ""}>Maintenance</option><option value="offline" ${car.fleet_status === "offline" ? "selected" : ""}>Offline</option></select></label>
      <label>Daily rate (£)<input name="pricePerDay" type="number" min="1" step="1" value="${escapeHtml(car.price_per_day)}" /></label>
      <label>Location<input name="locationLabel" maxlength="80" value="${escapeHtml(car.location_label)}" /></label>
      <label>Odometer (km)<input name="odometerKm" type="number" min="0" step="1" value="${escapeHtml(car.odometer_km)}" /></label>
      <label class="fleet-variants">Vehicle versions (JSON)<textarea name="variants" rows="6">${escapeHtml(JSON.stringify(car.variants || [], null, 2))}</textarea><small>Up to 12. Each needs id, name, design and pricePerDay.</small></label>
      <button class="save-vehicle" type="button" data-save-vehicle="${escapeHtml(car.id)}">Save vehicle updates</button></div></article>`;
    }).join("") || '<article class="ops-card empty-row">There are no vehicles in your fleet yet.</article>';
    applyFleetFilters();
  } catch (error) { showNotice(error.message, true); }
}

function applyFleetFilters() {
  const search = document.querySelector("#fleet-search").value.trim().toLowerCase();
  const status = document.querySelector("#fleet-filter").value;
  const cards = [...document.querySelectorAll("[data-fleet-card]")];
  let visible = 0;
  for (const card of cards) {
    const matches = (!search || card.dataset.vehicleSearch.includes(search))
      && (status === "all" || card.dataset.vehicleStatus === status);
    card.hidden = !matches;
    if (matches) visible += 1;
  }
  document.querySelector("#fleet-filter-count").textContent = `Showing ${visible} of ${cards.length} vehicles`;
  document.querySelector("#fleet-filter-empty").hidden = !cards.length || visible > 0;
}

async function loadCustomers() {
  try {
    const { customers } = await api("/api/operator/customers");
    document.querySelector("#customer-total").textContent = `${customers.length} customers`;
    document.querySelector("#customers-table").innerHTML = customers.length ? customers.map((customer) => `<tr>
      <td><div class="guest-cell"><strong>${escapeHtml(customer.full_name || "Profile incomplete")}</strong><small>Joined ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(customer.created_at))}</small></div></td>
      <td>${escapeHtml(customer.email)}<div class="sub-cell">${escapeHtml(customer.phone)}</div></td><td>${escapeHtml(customer.city || "—")}</td>
      <td>${customer.reservation_count}</td><td>${money(customer.lifetime_value)}</td></tr>`).join("") : '<tr><td colspan="5" class="empty-row">Customers will appear here after they create an account.</td></tr>';
  } catch (error) { showNotice(error.message, true); }
}

document.querySelector("#bookings-table").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-booking-id]");
  if (!select || !select.value) return;
  select.disabled = true;
  try {
    await api(`/api/operator/bookings/${encodeURIComponent(select.dataset.bookingId)}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }),
    });
    showNotice(`Reservation updated to ${select.value}.`);
    await Promise.all([loadBookings(), loadOverview()]);
  } catch (error) { showNotice(error.message, true); select.disabled = false; }
});

document.querySelector("#fleet-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-vehicle]");
  if (!button) return;
  const card = button.closest("[data-fleet-card]");
  const body = {};
  card.querySelectorAll("[name]").forEach((field) => {
    body[field.name] = field.type === "number" ? Number(field.value) : field.value;
  });
  button.disabled = true;
  try {
    await api(`/api/operator/cars/${encodeURIComponent(button.dataset.saveVehicle)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    showNotice("Vehicle details saved.");
    await Promise.all([loadFleet(), loadOverview()]);
  } catch (error) { showNotice(error.message, true); button.disabled = false; }
});

document.querySelector("#new-vehicle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form));
    await api("/api/operator/cars", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    form.reset();
    showNotice("Vehicle added to your fleet.");
    await Promise.all([loadFleet(), loadOverview()]);
  } catch (error) { showNotice(error.message, true); }
  finally { button.disabled = false; }
});

document.querySelector("#fleet-search").addEventListener("input", applyFleetFilters);
document.querySelector("#fleet-filter").addEventListener("change", applyFleetFilters);

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }
  catch (error) { showNotice(error.message, true); }
});

async function initialize() {
  try {
    const { user } = await api("/api/auth/me");
    if (!user || !["operator", "admin"].includes(user.role)) throw new Error("This workspace is only available to fleet operators.");
    document.querySelector("#operator-name").textContent = user.profile.fullName || user.email;
    document.querySelector("#page-title").textContent = `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, ${(user.profile.fullName || "Operator").split(" ")[0]}`;
    await loadOverview();
    const initialPanel = window.location.hash.slice(1);
    if (panels.some((panel) => panel.id === `panel-${initialPanel}`)) setPanel(initialPanel);
  } catch (error) { showNotice(error.message, true); }
}

initialize();
