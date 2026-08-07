/* Geospatial Webhook — page enhancements */
(function () {
  "use strict";

  /* ===== 1. Copy-to-clipboard for codeblocks ===== */
  function setupCopyButtons() {
    document.querySelectorAll(".code-block").forEach((block) => {
      const btn = block.querySelector(".code-block__copy");
      const codeEl = block.querySelector("pre code");
      if (!btn || !codeEl) return;
      btn.addEventListener("click", async () => {
        const text = codeEl.innerText;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          const label = btn.querySelector(".code-block__copy-label");
          const prior = label ? label.textContent : "Copy";
          btn.classList.add("is-copied");
          if (label) label.textContent = "Copied";
          setTimeout(() => {
            btn.classList.remove("is-copied");
            if (label) label.textContent = prior;
          }, 1600);
        } catch (e) {
          /* swallow */
        }
      });
    });
  }

  /* ===== 2. Make task-list checkboxes interactive =====
     markdown-it-task-lists may render with `disabled`. Strip it so visitors
     can tick boxes. Toggle a class on the LI for line-through styling.
  */
  function setupTaskLists() {
    document.querySelectorAll(".markdown li.task-list-item").forEach((li) => {
      // Remove the residual leading dot/marker (defensive — CSS already handles it).
      li.style.listStyle = "none";
      const cb = li.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.disabled = false;
      cb.removeAttribute("disabled");
      const sync = () => li.classList.toggle("is-done", cb.checked);
      cb.addEventListener("change", sync);
      sync();
    });
  }

  /* ===== 3. FAQ accordion conversion =====
     If a heading text matches "FAQ" or "Frequently Asked Questions", wrap each
     following sub-heading + content into a <details class="faq"> element.
  */
  function setupFaq() {
    const md = document.querySelector(".markdown");
    if (!md) return;
    const heads = Array.from(md.querySelectorAll("h2, h3"));
    const faqRoots = heads.filter((h) =>
      /^(faq|frequently asked questions?)\b/i.test(h.textContent.trim())
    );
    if (faqRoots.length === 0) return;

    faqRoots.forEach((root) => {
      const stopAt = root.tagName;
      const childSelector = stopAt === "H2" ? "H3" : "H4";
      // Walk siblings, collect Q/A pairs.
      let cur = root.nextElementSibling;
      const items = [];
      let current = null;
      while (cur && cur.tagName !== stopAt) {
        if (cur.tagName === childSelector) {
          if (current) items.push(current);
          current = { q: cur, body: [] };
        } else if (current) {
          current.body.push(cur);
        }
        cur = cur.nextElementSibling;
      }
      if (current) items.push(current);
      // If no Q/A subheadings, leave alone (avoids breaking unrelated FAQ-style copy).
      if (items.length === 0) return;
      items.forEach(({ q, body }) => {
        const det = document.createElement("details");
        det.className = "faq";
        const sum = document.createElement("summary");
        sum.textContent = q.textContent.trim();
        det.appendChild(sum);
        const wrap = document.createElement("div");
        wrap.className = "faq__body";
        body.forEach((n) => wrap.appendChild(n));
        det.appendChild(wrap);
        q.parentNode.insertBefore(det, q);
        q.remove();
      });
    });
  }

  /* ===== 4. Theme toggle =====
     The stored choice is already applied by the inline <head> script, so all
     this does is keep the control's label truthful and write the next choice.
     With no stored choice the page follows prefers-color-scheme, and the first
     click commits whatever the reader is looking at to the opposite.
  */
  function setupThemeToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    function active() {
      const explicit = document.documentElement.getAttribute("data-theme");
      if (explicit === "dark" || explicit === "light") return explicit;
      return prefersDark.matches ? "dark" : "light";
    }

    function syncLabel() {
      const next = active() === "dark" ? "light" : "dark";
      const label = "Switch to " + next + " theme";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    }

    btn.addEventListener("click", () => {
      const next = active() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("gsw-theme", next);
      } catch (e) {
        /* private mode — the choice just does not survive the page */
      }
      syncLabel();
    });

    // Follow the OS while the reader has not chosen one explicitly.
    const onSchemeChange = () => {
      if (!document.documentElement.hasAttribute("data-theme")) syncLabel();
    };
    if (prefersDark.addEventListener) {
      prefersDark.addEventListener("change", onSchemeChange);
    } else if (prefersDark.addListener) {
      prefersDark.addListener(onSchemeChange);
    }

    syncLabel();
  }

  /* ===== 5. Smooth scroll offset for in-page anchor clicks (defensive) =====
     scroll-margin-top in CSS handles modern browsers; this is a safety net.
  */
  function setupAnchorOffsets() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href").slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        const header = document.querySelector(".site-header");
        const offset = header ? header.getBoundingClientRect().height + 12 : 0;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: "smooth" });
        history.pushState(null, "", "#" + id);
      });
    });
  }

  function init() {
    setupCopyButtons();
    setupTaskLists();
    setupFaq();
    setupThemeToggle();
    setupAnchorOffsets();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
