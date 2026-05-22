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

  /* ===== 4. Mermaid (CDN-free fallback: only initialize if pre.mermaid exists) ===== */
  function setupMermaid() {
    if (!document.querySelector("pre.mermaid")) return;
    // Load mermaid only when needed, from local copy.
    const s = document.createElement("script");
    s.src = "/assets/js/mermaid.min.js";
    s.onload = function () {
      if (window.mermaid) {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#fbd0b5",
            primaryTextColor: "#4a3825",
            primaryBorderColor: "#b85a39",
            lineColor: "#8f7150",
            secondaryColor: "#b7e1c4",
            tertiaryColor: "#fff5ee",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        });
        window.mermaid.run({ querySelector: "pre.mermaid" });
      }
    };
    s.onerror = function () {
      // No mermaid library available — leave the rendered text in place (still readable).
    };
    document.head.appendChild(s);
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
    setupMermaid();
    setupAnchorOffsets();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
