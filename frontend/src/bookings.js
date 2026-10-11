const bookingList = document.querySelector("#booking-list");
const paymentReturn = new URLSearchParams(window.location.search);
const returnedBookingId = paymentReturn.get("bookingId");
const returnedSessionId = paymentReturn.get("session_id");

function escapeBookingHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function renderBookings(bookings) {
  if (bookings.length === 0) {
    bookingList.innerHTML = '<div class="empty-bookings"><span aria-hidden="true">✳</span><h2>Nothing on the calendar. Yet.</h2><p>Your reservation requests will find their way here.</p><a class="button button-primary" href="/cars.html">Meet the collection <span aria-hidden="true">→</span></a></div>';
    return;
  }
  bookingList.innerHTML = bookings.map((booking) => {
    const carName = booking.car ? `${booking.car.make} ${booking.car.model}` : "Lux Collection vehicle";
    const variant = booking.car?.variant;
    const image = booking.car?.image || "";
    const statusLabels = {
      requested: "Request under review",
      confirmed: "Reservation confirmed",
      active: "Rental in progress",
      completed: "Rental completed",
      cancelled: "Request cancelled",
      rejected: "Request declined",
    };
    const status = statusLabels[booking.status] || "Reservation update";
    const statusClass = {
      requested: "status-pending",
      confirmed: "status-confirmed",
      active: "status-active",
      completed: "status-completed",
      cancelled: "status-cancelled",
      rejected: "status-rejected",
    }[booking.status] || "status-pending";
    const canCancel = booking.status === "requested";
    const payment = booking.payment;
    const paymentControls = booking.status === "confirmed" && payment?.pending
      ? `<p class="payment-receipt">Payment is being confirmed securely. Refresh this page in a moment.</p>`
      : booking.status === "confirmed" && payment?.due > 0
      ? `<div class="booking-payment"><p>${payment.status === "partial" ? `${money(payment.paid)} received · ` : ""}${money(payment.due)} remaining</p>
          <label>Choose an amount<select data-payment-plan><option value="full">Pay full balance</option><option value="half">Pay 50% of balance now</option><option value="deposit">Pay 20% of balance now</option></select></label>
          <button class="pay-reservation" type="button" data-pay-booking="${escapeBookingHtml(booking._id)}">Continue to secure payment</button></div>`
      : payment?.status === "paid" ? `<p class="payment-receipt">Paid in full · ${money(payment.paid)}</p>` : "";
    return `<article class="booking-history-card">
      <img src="${escapeBookingHtml(image)}" alt="${escapeBookingHtml(carName)}" loading="lazy" />
      <div class="booking-history-copy">
        <span class="booking-status ${statusClass}"><i></i>${status}</span>
        <h2>${escapeBookingHtml(carName)}</h2>
        ${variant ? `<p>${escapeBookingHtml(variant.name)}${variant.design ? ` Â· ${escapeBookingHtml(variant.design)}` : ""}</p>` : ""}
        <p>${formatDate(booking.startDate)} <span aria-hidden="true">→</span> ${formatDate(booking.endDate)}</p>
        <p>${escapeBookingHtml(booking.pickupLocation)} · ${booking.days} ${booking.days === 1 ? "day" : "days"}</p>
        <strong>£${Number(booking.totalPrice).toLocaleString("en-GB")} <span>estimated</span></strong>
      </div>
      ${paymentControls}
      ${canCancel ? `<button class="cancel-reservation" type="button" data-cancel-id="${escapeBookingHtml(booking._id)}">Cancel request</button>` : ""}
    </article>`;
  }).join("");
}

async function loadBookings() {
  try {
    const response = await fetch("/api/bookings", { credentials: "same-origin" });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/login.html?next=/my-bookings.html");
      return;
    }
    if (response.status === 403) {
      window.location.replace("/profile.html");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your reservations couldn’t be loaded.");
    renderBookings(result.bookings);
    if (paymentReturn.get("payment") === "return"
      && /^[1-9]\d*$/.test(returnedBookingId || "")
      && /^cs_[A-Za-z0-9_]+$/.test(returnedSessionId || "")) await confirmReturnedPayment();
    if (paymentReturn.get("payment") === "cancelled") {
      const notice = document.createElement("p");
      notice.className = "booking-confirmation";
      notice.setAttribute("role", "status");
      notice.textContent = "Checkout was cancelled. No payment was recorded; you can try again whenever you are ready.";
      bookingList.prepend(notice);
    }
    if (new URLSearchParams(window.location.search).get("requested") === "1") {
      const confirmation = document.createElement("p");
      confirmation.className = "booking-confirmation";
      confirmation.setAttribute("role", "status");
      confirmation.textContent = "Thank you. Your request is with our team, and we’ll be in touch to confirm it personally.";
      bookingList.prepend(confirmation);
    }
  } catch (error) {
    bookingList.innerHTML = "";
    const message = document.createElement("p");
    message.className = "form-error";
    message.textContent = error.message || "We couldn’t reach Lux Collection. Please try again.";
    bookingList.append(message);
  }
}

async function confirmReturnedPayment() {
  const dialog = document.querySelector("#payment-success-dialog");
  const copy = document.querySelector("#payment-success-copy");
  const amount = document.querySelector("#payment-success-amount");
  copy.textContent = "We’re securely checking your payment with Stripe. This usually takes a few seconds.";
  dialog.showModal();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(`/api/payments/return/${encodeURIComponent(returnedSessionId)}`, { credentials: "same-origin" });
      if (response.ok) {
        const payment = await response.json();
        if (payment.status === "paid") {
          copy.textContent = "Your payment has been confirmed securely. Your reservation details are below.";
          amount.textContent = `${money(payment.amount)} received`;
          window.history.replaceState({}, "", "/my-bookings.html");
          await loadBookings();
          return;
        }
        if (["failed", "expired"].includes(payment.status)) {
          copy.textContent = "This payment was not completed. You can try again from your reservation.";
          return;
        }
      }
    } catch { /* Keep checking briefly while the payment confirmation arrives. */ }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  copy.textContent = "Your checkout finished, and we’re still waiting for secure payment confirmation. Your reservation will update automatically once it arrives.";
}

document.querySelector("#payment-success-close").addEventListener("click", () => {
  document.querySelector("#payment-success-dialog").close();
  window.history.replaceState({}, "", "/my-bookings.html");
});

bookingList.addEventListener("click", async (event) => {
  const payButton = event.target.closest("[data-pay-booking]");
  if (payButton) {
    const card = payButton.closest(".booking-history-card");
    const plan = card.querySelector("[data-payment-plan]").value;
    payButton.disabled = true;
    try {
      const response = await fetch(`/api/payments/${encodeURIComponent(payButton.dataset.payBooking)}/checkout`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The payment page could not be opened.");
      window.location.assign(result.url);
    } catch (error) {
      payButton.disabled = false;
      const message = document.createElement("p");
      message.className = "form-error";
      message.setAttribute("role", "alert");
      message.textContent = error.message || "We could not open secure payment. Please try again.";
      card.querySelector(".booking-payment")?.append(message);
    }
    return;
  }
  const button = event.target.closest("[data-cancel-id]");
  if (!button) return;
  if (!window.confirm("Cancel this reservation request? The dates will become available again.")) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(button.dataset.cancelId)}/cancel`, {
      method: "POST",
      credentials: "same-origin",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The request could not be cancelled.");
    await loadBookings();
  } catch (error) {
    button.disabled = false;
    const message = document.createElement("p");
    message.className = "form-error";
    message.setAttribute("role", "alert");
    message.textContent = error.message || "We couldn’t reach Lux Collection. Please try again.";
    bookingList.prepend(message);
  }
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("We couldn’t safely end your session. Please try again.");
    window.location.assign("/");
  } catch (error) {
    const message = document.createElement("p");
    message.className = "form-error";
    message.textContent = error.message;
    bookingList.prepend(message);
  }
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

loadBookings();
