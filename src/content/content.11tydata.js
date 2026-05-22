// Directory data applied to all markdown files under src/content/.
// Derives title, description, permalink, section, and depth from the file path
// and content so each page gets unique SEO-relevant metadata.
const fs = require("fs");
const path = require("path");

function relFromContent(inputPath) {
  const norm = inputPath.replace(/\\/g, "/");
  const marker = "/src/content/";
  const idx = norm.indexOf(marker);
  if (idx === -1) {
    const m2 = norm.indexOf("src/content/");
    if (m2 === -1) return null;
    return norm.slice(m2 + "src/content/".length);
  }
  return norm.slice(idx + marker.length);
}

function readFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    return "";
  }
}

function extractTitle(raw) {
  const m = raw.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : "";
}

// Pull the first non-empty paragraph that isn't a heading or code fence.
// Strip markdown formatting and trim to a sensible meta-description length.
function extractDescription(raw) {
  const lines = raw.split(/\r?\n/);
  let buf = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^\s*$/.test(line)) {
      if (buf.length) break;
      continue;
    }
    buf.push(line.trim());
  }
  let text = buf.join(" ");
  // Strip markdown links [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Strip inline code, bold, italics markers
  text = text.replace(/[`*_]/g, "");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  // Clip to ~160 chars at a word boundary
  if (text.length > 160) {
    text = text.slice(0, 157);
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace > 100) text = text.slice(0, lastSpace);
    text += "…";
  }
  return text;
}

module.exports = {
  layout: "page",
  tags: ["content"],
  eleventyComputed: {
    title: (data) => {
      if (data.title) return data.title;
      const file = data.page && data.page.inputPath;
      if (!file) return "";
      return extractTitle(readFile(file));
    },
    description: (data) => {
      if (data.description) return data.description;
      const file = data.page && data.page.inputPath;
      if (!file) return "";
      return extractDescription(readFile(file));
    },
    permalink: (data) => {
      if (data.permalink) return data.permalink;
      const file = data.page && data.page.inputPath;
      if (!file) return false;
      const rel = relFromContent(file);
      if (!rel) return false;
      const dir = path.posix.dirname(rel);
      if (!dir || dir === ".") return "/";
      return "/" + dir + "/";
    },
    section: (data) => {
      const file = data.page && data.page.inputPath;
      if (!file) return "";
      const rel = relFromContent(file);
      if (!rel) return "";
      const parts = rel.split("/");
      return parts[0] || "";
    },
    depth: (data) => {
      const file = data.page && data.page.inputPath;
      if (!file) return 0;
      const rel = relFromContent(file);
      if (!rel) return 0;
      const parts = path.posix.dirname(rel).split("/").filter(Boolean);
      return parts.length;
    },
  },
};
