/**
 * Simple active-state for sidebar nav links.
 * Mark links with `data-nav-href="index.html"` etc.
 */

(function navActive() {
  const current = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("[data-nav-href]").forEach((a) => {
    const href = String(a.getAttribute("data-nav-href") || "").toLowerCase();
    if (!href) return;
    const isActive = href === current;
    a.classList.toggle("text-slate-900", isActive);
    a.classList.toggle("bg-slate-50", isActive);
    a.classList.toggle("border", isActive);
    a.classList.toggle("border-slate-200/50", isActive);
    a.classList.toggle("shadow-sm", isActive);
    a.classList.toggle("text-slate-500", !isActive);
  });
})();

