#!/usr/bin/env node
/* Assemble the ZeroTwo dashboard into ONE self-contained HTML file.
 * Inlines: terminal.css, React+ReactDOM (production UMD), sha256.js, and the
 * Babel-compiled component scripts (classic runtime -> React.createElement).
 * No CDN, no in-browser Babel, no build step required to deploy the output. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "..", "index.html");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Defensive: a literal </script> inside inlined JS would close the tag early.
// Escaping the slash is valid inside any JS string/regex/comment (the only
// places the sequence can legally appear).
const safeJs = (s) => s.replace(/<\/script/gi, "<\\/script");

const css = read("src/terminal.css");
if (/<\/style/i.test(css)) throw new Error("CSS contains </style> — would break the <style> tag");

// Load order matches the original HTML: react, react-dom, sha256, components,
// requests, terminal, app.
//
// `wrap` = true puts the script body in its own IIFE. The component files each
// open with `const { useState, ... } = React;` at top level. As separate inline
// <script>s they would share one global lexical scope and collide ("Identifier
// already declared"); the original prototype avoided this because Babel-standalone
// runs each text/babel script in its own scope. Wrapping reproduces that. All
// cross-file symbols are shared via `Object.assign(window, …)`, so this is safe.
// React/ReactDOM (UMD, self-wrapping) and sha256 (already an IIFE) are left as-is.
const scripts = [
  ["react 18.3.1 (production umd)",       read("node_modules/react/umd/react.production.min.js"),    false],
  ["react-dom 18.3.1 (production umd)",    read("node_modules/react-dom/umd/react-dom.production.min.js"), false],
  ["sha256 (geraintluff, public domain)",  read("src/sha256.js"),     false],
  ["components",                           read("compiled/components.js"), true],
  ["requests",                             read("compiled/requests.js"),   true],
  ["terminal",                             read("compiled/terminal.js"),   true],
  ["app (mounts <App/>)",                  read("compiled/app.js"),        true],
];

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
  "%3Crect width='32' height='32' fill='%23060a08'/%3E%3Ctext x='16' y='23' font-family='monospace' " +
  "font-size='20' font-weight='700' fill='%234af0a9' text-anchor='middle'%3E02%3C/text%3E%3C/svg%3E";

const parts = [];
parts.push("<!DOCTYPE html>");
parts.push('<html lang="en">');
parts.push("<head>");
parts.push('  <meta charset="UTF-8" />');
parts.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0" />');
parts.push("  <title>ZeroTwo Systems — HomeLab Nexus</title>");
parts.push("");
parts.push("  <!-- Split-hosting only: if the request backend lives on a DIFFERENT host than this");
parts.push("       page (e.g. page on SiteGround, backend on your TrueNAS box), set content to the");
parts.push('       backend\'s public base URL, e.g. content="https://api.zerotwosystems.nl". Leave');
parts.push("       empty when the same server serves both this page and /api/. -->");
parts.push('  <meta name="zerotwo-api-base" content="" />');
parts.push("");
parts.push("  <!-- Single self-contained build. Drop index.html into your nginx web root.");
parts.push("       The request system's per-IP/day limit");
parts.push("       is enforced by backend/ (see README.md); without it the request panel runs");
parts.push("       in a clearly-labelled demo mode. -->");
parts.push("");
parts.push('  <link rel="preconnect" href="https://fonts.googleapis.com" />');
parts.push('  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
parts.push('  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700&display=swap" rel="stylesheet" />');
parts.push("");
parts.push('  <link rel="icon" href="' + FAVICON + '" />');
parts.push("");
parts.push("  <style>");
parts.push(css);
parts.push("  </style>");
parts.push("</head>");
parts.push("<body>");
parts.push('  <div class="crt-vignette"></div>');
parts.push('  <div class="crt-scanlines"></div>');
parts.push("");
parts.push('  <div id="root"></div>');
parts.push("");
for (const [label, code, wrap] of scripts) {
  const body = safeJs(code).trimEnd();
  parts.push("  <!-- " + label + " -->");
  parts.push("  <script>");
  if (wrap) {
    parts.push("(function () {");
    parts.push(body);
    parts.push("})();");
  } else {
    parts.push(body);
  }
  parts.push("  </script>");
}
parts.push("</body>");
parts.push("</html>");
parts.push("");

const html = parts.join("\n");
fs.writeFileSync(OUT, html, "utf8");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log("Wrote " + OUT);
console.log("Size: " + kb(Buffer.byteLength(html)));
console.log("Sanity checks:");
console.log("  <div id=\"root\">      : " + html.includes('<div id="root">'));
console.log("  ReactDOM.createRoot   : " + html.includes("ReactDOM.createRoot") );
console.log("  no unpkg/CDN js       : " + !/unpkg\.com|babel/i.test(html.replace(/JetBrains|Noto/g,"")));
console.log("  no text/babel script  : " + !/text\/babel/.test(html));
console.log("  OPERATOR_KEY present  : " + html.includes("OPERATOR_KEY_SHA256"));
