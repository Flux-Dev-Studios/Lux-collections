const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  menuToggle.setAttribute("aria-label", isExpanded ? "Open navigation" : "Close navigation");
  primaryNav.classList.toggle("is-open", !isExpanded);
});

primaryNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    primaryNav.classList.remove("is-open");
  });
});

document.querySelectorAll("#current-year, [data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

if (document.body.classList.contains("landing-page")) {
  const revealStyles = [
    [".hero", "hero"],
    [".collection-ribbon", "ribbon"],
    [".landing-fleet-section", "fleet"],
    [".welcome-section", "invitation"],
    [".experience-section", "experience"],
    [".how-section", "steps"],
    [".quote-section", "quote"],
    [".service-faq", "faq"],
    [".closing-section", "closing"],
  ];

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const main = document.querySelector("main#main");
    const sections = revealStyles
      .map(([selector, style]) => {
        const section = document.querySelector(selector);
        if (!section) return null;
        section.dataset.reveal = style;
        section.classList.add("reveal-section");
        return section;
      })
      .filter(Boolean);
    const hero = sections.find((section) => section.dataset.reveal === "hero");
    if (hero) requestAnimationFrame(() => hero.classList.add("is-revealed"));

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { root: main, threshold: 0.12, rootMargin: "0px 0px -5% 0px" });

    sections.filter((section) => section !== hero).forEach((section) => observer.observe(section));
  }
}

const landingFleetGrid = document.querySelector("#landing-fleet-grid");

if (landingFleetGrid) {
  const fleetTrack = landingFleetGrid.querySelector("[data-fleet-track]");
  const safeImageUrl = (value) => {
    try {
      const url = new URL(value, window.location.origin);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  fetch("/api/cars/preview")
    .then((response) => {
      if (!response.ok) throw new Error("Could not load vehicle previews.");
      return response.json();
    })
    .then(({ cars }) => {
      if (!Array.isArray(cars) || !cars.length) {
        fleetTrack.innerHTML = '<p class="fleet-carousel-status">The collection is being refreshed. Please check back soon.</p>';
        return;
      }

      const cards = cars.map((car) => {
        const name = `${car.make} ${car.model}`;
        const image = safeImageUrl(car.image);
        const category = Array.isArray(car.category) ? car.category[0] : car.category;
        const imageContent = image
          ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" />`
          : "";

        return `<article class="landing-fleet-card">
          <a class="fleet-card-image" href="/register.html" aria-label="Explore the ${escapeHtml(name)}">
            ${imageContent}
            <span class="fleet-card-badge">${escapeHtml(category || "Collection")}</span>
            <span class="fleet-card-image-caption">Made for the way there.</span>
          </a>
          <div class="fleet-card-body">
            <div class="fleet-card-name"><span class="fleet-card-make">${escapeHtml(car.make)}</span><h3>${escapeHtml(car.model)}</h3></div>
            <div class="fleet-card-price"><strong>£${Number(car.pricePerDay).toLocaleString("en-GB")}</strong><span>per day</span></div>
          </div>
        </article>`;
      }).join("");

      const originalGroup = document.createElement("div");
      originalGroup.className = "fleet-carousel-group";
      originalGroup.innerHTML = cards;
      const duplicateGroup = originalGroup.cloneNode(true);
      duplicateGroup.setAttribute("aria-hidden", "true");
      duplicateGroup.inert = true;
      fleetTrack.replaceChildren(originalGroup, duplicateGroup);
      landingFleetGrid.dataset.loaded = "true";

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const previousButton = document.querySelector("[data-fleet-prev]");
      const nextButton = document.querySelector("[data-fleet-next]");
      let pointerInside = false;
      let focusInside = false;
      let resumeAfter = 0;
      let lastFrame = 0;

      const loopDistance = () => originalGroup.getBoundingClientRect().width + 18;
      const pauseBriefly = () => { resumeAfter = performance.now() + 2400; };
      const moveByCard = (direction) => {
        pauseBriefly();
        const card = originalGroup.querySelector(".landing-fleet-card");
        const cardWidth = card?.getBoundingClientRect().width || 320;
        landingFleetGrid.scrollBy({ left: direction * (cardWidth + 18), behavior: "smooth" });
      };

      previousButton?.addEventListener("click", () => moveByCard(-1));
      nextButton?.addEventListener("click", () => moveByCard(1));
      landingFleetGrid.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          moveByCard(event.key === "ArrowLeft" ? -1 : 1);
        }
      });
      landingFleetGrid.addEventListener("mouseenter", () => { pointerInside = true; });
      landingFleetGrid.addEventListener("mouseleave", () => { pointerInside = false; });
      landingFleetGrid.addEventListener("focusin", () => { focusInside = true; });
      landingFleetGrid.addEventListener("focusout", (event) => {
        if (!landingFleetGrid.contains(event.relatedTarget)) focusInside = false;
      });
      landingFleetGrid.addEventListener("touchstart", pauseBriefly, { passive: true });
      landingFleetGrid.addEventListener("wheel", pauseBriefly, { passive: true });

      const animate = (now) => {
        const elapsed = lastFrame ? Math.min(now - lastFrame, 48) : 0;
        lastFrame = now;
        if (!reducedMotion && !document.hidden && !pointerInside && !focusInside && now >= resumeAfter) {
          landingFleetGrid.scrollLeft += elapsed * 0.022;
          const distance = loopDistance();
          if (distance > 0 && landingFleetGrid.scrollLeft >= distance) landingFleetGrid.scrollLeft -= distance;
        }
        window.requestAnimationFrame(animate);
      };

      if (!reducedMotion) window.requestAnimationFrame(animate);
    })
    .catch(() => {
      fleetTrack.innerHTML = '<p class="fleet-carousel-status">We couldn’t load the collection just now. Please try again shortly.</p>';
    });
}
