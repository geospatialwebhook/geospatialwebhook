const path = require("path");
const crypto = require("crypto");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const markdownItAttrs = require("markdown-it-attrs");
const markdownItTaskLists = require("markdown-it-task-lists");
const Prism = require("prismjs");
require("prismjs/components/prism-python");
require("prismjs/components/prism-bash");
require("prismjs/components/prism-json");
require("prismjs/components/prism-sql");
require("prismjs/components/prism-yaml");

const ASCII_DIAGRAM_RE = /[│├└─▼▲←→]|[\s]{2,}▼/;

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asciiDiagramToMermaid(raw) {
  // Detect a vertical "Step → Step → Step" ASCII diagram and convert to mermaid flowchart.
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const nodes = lines.filter(
    (l) => !/^[│▼▲|]+$/.test(l) && !/^[─┌┐└┘├┤┬┴┼]+$/.test(l)
  );
  if (nodes.length < 2) return null;
  // For each step:
  //  - lines like "[Name] → description" → take "Name" as title, description as subtitle
  //  - bare lines → use as title
  const clean = nodes.map((n) => {
    const bracket = n.match(/^\[([^\]]+)\]\s*(?:→\s*(.+))?$/);
    if (bracket) {
      const title = bracket[1].trim();
      const desc = (bracket[2] || "").trim();
      return desc ? `${title} — ${desc}` : title;
    }
    return n.replace(/^→\s*/, "").trim();
  });
  // Sanitize for mermaid node bracket content.
  const sanitize = (s) => s.replace(/[\[\]"]/g, "").replace(/\s+/g, " ");
  let out = "flowchart TD\n";
  for (let i = 0; i < clean.length; i++) {
    out += `  N${i}["${sanitize(clean[i])}"]\n`;
  }
  for (let i = 0; i < clean.length - 1; i++) {
    out += `  N${i} --> N${i + 1}\n`;
  }
  return out;
}

const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
});

// Custom fence renderer (avoid markdown-it auto-wrapping inside <pre><code>).
md.renderer.rules.fence = function (tokens, idx) {
  const token = tokens[idx];
  const code = token.content;
  const info = token.info ? token.info.trim() : "";
  const lang = info.split(/\s+/)[0] || "";

  // ASCII pipeline diagrams → mermaid.
  const isDiagramLang = !lang || lang === "text" || lang === "txt";
  if (isDiagramLang && ASCII_DIAGRAM_RE.test(code)) {
    const mer = asciiDiagramToMermaid(code);
    if (mer) {
      return `<pre class="mermaid" tabindex="0">${escapeHtml(mer)}</pre>\n`;
    }
  }

  let highlighted;
  if (lang && Prism.languages[lang]) {
    highlighted = Prism.highlight(code, Prism.languages[lang], lang);
  } else {
    highlighted = escapeHtml(code);
  }
  const label = lang ? lang : "text";
  const safeLabel = escapeHtml(label);
  return `<div class="code-block" data-lang="${safeLabel}">
  <div class="code-block__header">
    <span class="code-block__lang">${safeLabel}</span>
    <button type="button" class="code-block__copy" aria-label="Copy code">
      <span class="code-block__copy-label">Copy</span>
    </button>
  </div>
  <pre class="language-${safeLabel}" tabindex="0"><code class="language-${safeLabel}">${highlighted}</code></pre>
</div>\n`;
};

md.use(markdownItAnchor, {
  permalink: markdownItAnchor.permalink.headerLink({
    class: "heading-anchor",
  }),
  slugify: (s) =>
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-"),
});
md.use(markdownItAttrs);
md.use(markdownItTaskLists, { enabled: true, label: true, labelAfter: false });

// Wrap rendered tables in a horizontally-scrollable container.
const defaultTableOpen =
  md.renderer.rules.table_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
const defaultTableClose =
  md.renderer.rules.table_close || ((t, i, o, e, s) => s.renderToken(t, i, o));
md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
  `<div class="table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`;
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  `${defaultTableClose(tokens, idx, options, env, self)}</div>`;

module.exports = function (eleventyConfig) {
  eleventyConfig.setLibrary("md", md);

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });

  // Layout aliases.
  eleventyConfig.addLayoutAlias("base", "layouts/base.njk");
  eleventyConfig.addLayoutAlias("page", "layouts/page.njk");
  eleventyConfig.addLayoutAlias("home", "layouts/home.njk");

  // Section data: derive top-level section slug from URL path so layouts can
  // highlight nav and build breadcrumbs.
  eleventyConfig.addFilter("topSection", (url) => {
    if (!url || url === "/") return "home";
    const parts = url.split("/").filter(Boolean);
    return parts[0] || "home";
  });

  eleventyConfig.addFilter("humanize", (slug) => {
    if (!slug) return "";
    return String(slug)
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  });

  // ISO date filter — accepts Date, number, or string and formats as YYYY-MM-DD.
  eleventyConfig.addFilter("isoDate", (value) => {
    let d;
    if (value instanceof Date) d = value;
    else if (typeof value === "number") d = new Date(value);
    else if (typeof value === "string") d = new Date(value);
    else d = new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.toISOString().slice(0, 10);
  });

  // mtime of an input file (best-effort) for sitemap lastmod.
  const fs = require("fs");
  eleventyConfig.addFilter("fileDate", (inputPath) => {
    try {
      const stat = fs.statSync(inputPath);
      return stat.mtime.toISOString().slice(0, 10);
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  });

  // Content-hash cache-buster for immutable assets.
  // URL /assets/... maps to source src/assets/... via the passthrough copy config.
  eleventyConfig.addFilter("assetHash", (url) => {
    try {
      const relative = url.replace(/^\//, "").split("?")[0];
      const srcRelative = relative.replace(/^assets\//, "src/assets/");
      const filePath = path.join(__dirname, srcRelative);
      const hash = crypto
        .createHash("md5")
        .update(fs.readFileSync(filePath))
        .digest("hex")
        .slice(0, 8);
      return `${url}?v=${hash}`;
    } catch {
      return url;
    }
  });

  // Breadcrumb segments from a URL (excluding home).
  eleventyConfig.addFilter("breadcrumbs", (url) => {
    if (!url || url === "/") return [];
    const parts = url.replace(/^\/|\/$/g, "").split("/");
    const crumbs = [];
    let path = "";
    for (const p of parts) {
      path += "/" + p;
      crumbs.push({ slug: p, url: path + "/", label: p.replace(/-/g, " ") });
    }
    return crumbs;
  });

  // Children of a content page: pages whose URL starts with current url and is one level deeper.
  eleventyConfig.addFilter("childrenOf", (collection, url) => {
    if (!collection || !url) return [];
    const baseDepth = url.replace(/^\/|\/$/g, "").split("/").length;
    return collection
      .filter((item) => {
        if (!item.url || item.url === url) return false;
        if (!item.url.startsWith(url)) return false;
        const itemDepth = item.url.replace(/^\/|\/$/g, "").split("/").length;
        return itemDepth === baseDepth + 1;
      })
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""));
  });

  // Siblings of a page (same parent, exclude self).
  eleventyConfig.addFilter("siblingsOf", (collection, url) => {
    if (!collection || !url) return [];
    const parts = url.replace(/^\/|\/$/g, "").split("/");
    if (parts.length < 2) return [];
    const parent = "/" + parts.slice(0, -1).join("/") + "/";
    return collection.filter((item) => {
      if (!item.url || item.url === url) return false;
      if (!item.url.startsWith(parent)) return false;
      const itemParts = item.url.replace(/^\/|\/$/g, "").split("/");
      return itemParts.length === parts.length;
    });
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html", "11ty.js"],
  };
};
