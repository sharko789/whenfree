// Minimal i18n: per-locale JSON catalogs, t() with {{var}} interpolation,
// static DOM translation via data-i18n* attributes, locale auto-detect
// (persisted choice wins, then browser language) and the EN/DE switcher.
// Load before common.js; page scripts await WF_I18N.ready before rendering.
window.WF_I18N = (function () {
  "use strict";

  const SUPPORTED = ["en", "de"];
  const LS_KEY = "whenfree.locale";
  const catalogs = {}; // locale -> catalog; "en" doubles as fallback

  function detectLocale() {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (SUPPORTED.includes(saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    try {
      const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
      for (const l of langs) if (String(l).toLowerCase().startsWith("de")) return "de";
    } catch (e) {}
    return "en";
  }

  let locale = detectLocale();
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  async function loadCatalog(l) {
    if (catalogs[l]) return;
    try {
      const res = await fetch("/locales/" + l + ".json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      catalogs[l] = await res.json();
    } catch (e) {
      catalogs[l] = {}; // t() then falls back to the other catalog
    }
  }

  function t(key, vars) {
    let s = (catalogs[locale] || {})[key];
    if (s === undefined) s = (catalogs.en || {})[key];
    if (s === undefined) s = key;
    if (vars) for (const k in vars) s = s.split("{{" + k + "}}").join(vars[k]);
    return s;
  }

  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.dataset.i18nPh)); });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.setAttribute("title", t(el.dataset.i18nTitle)); });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === locale));
    document.documentElement.lang = locale;
  }

  async function setLocale(l) {
    if (!SUPPORTED.includes(l) || l === locale) return;
    locale = l;
    try { localStorage.setItem(LS_KEY, l); } catch (e) {}
    await loadCatalog(l);
    applyStatic();
    document.dispatchEvent(new CustomEvent("wf:locale", { detail: { locale: l } }));
  }

  function bindSwitcher() {
    // Delegated: works for the re-rendered topbar in the organizer dead panel.
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".lang-btn");
      if (btn) setLocale(btn.dataset.lang);
    });
  }

  async function init() {
    bindSwitcher();
    await Promise.all([loadCatalog("en"), loadCatalog(locale)]);
    applyStatic();
    document.documentElement.removeAttribute("data-i18n-loading");
    resolveReady();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return {
    get locale() { return locale; },
    supported: SUPPORTED,
    ready,
    t,
    applyStatic,
    setLocale,
  };
})();
