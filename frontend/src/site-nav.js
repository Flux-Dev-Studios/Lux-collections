const page = document.body;
const sidebar = document.querySelector("#site-side-nav");
const toggleButton = document.querySelector("#site-nav-reopen");

if (page && sidebar && toggleButton) {
  toggleButton.hidden = false;
  toggleButton.setAttribute("aria-expanded", "true");
  toggleButton.setAttribute("aria-label", "Close navigation");

  function setCollapsed(collapsed, restoreFocus = true) {
    page.classList.toggle("site-nav-collapsed", collapsed);
    sidebar.inert = collapsed;
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", collapsed ? "Open navigation" : "Close navigation");
    const logo = toggleButton.querySelector(".wordmark-icon");
    if (logo) {
      logo.classList.remove("site-nav-logo-rolling-left", "site-nav-logo-rolling-right");
      void logo.offsetWidth;
      const rollingClass = collapsed ? "site-nav-logo-rolling-left" : "site-nav-logo-rolling-right";
      logo.classList.add(rollingClass);
      logo.addEventListener("animationend", () => logo.classList.remove(rollingClass), { once: true });
    }
    if (restoreFocus) toggleButton.focus();
  }

  toggleButton.addEventListener("click", () => {
    setCollapsed(!page.classList.contains("site-nav-collapsed"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !page.classList.contains("site-nav-collapsed")) {
      setCollapsed(true);
    }
  });
}
