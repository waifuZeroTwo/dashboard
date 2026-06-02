"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "ZeroTwo Dashboard.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + ((e && (e.detail && e.detail.stack)) || (e && e.message) || e)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://zerotwosystems.com/",
  virtualConsole: vc,
  beforeParse(window) {
    // Stub fetch so status pings resolve to "down" rather than throwing.
    window.fetch = () => Promise.reject(new Error("no-net (smoke test)"));
  },
});

setTimeout(() => {
  const doc = dom.window.document;
  const root = doc.getElementById("root");
  const text = (root && root.textContent) || "";
  const inner = (root && root.innerHTML) || "";
  const checks = {
    "root mounted (has children)":       !!(root && root.children.length > 0),
    "brand ZEROTWO":                     text.includes("ZEROTWO"),
    "hero title 'ZeroTwo Systems'":      text.includes("ZeroTwo Systems"),
    "time-aware greeting":               /good (morning|afternoon|evening|night)|midnight oil/i.test(text),
    "cluster: MEDIA":                    text.includes("MEDIA"),
    "cluster: STORAGE & CLOUD":          text.includes("STORAGE & CLOUD"),
    "cluster: NETWORK & AUTOMATION":     text.includes("NETWORK & AUTOMATION"),
    "Plex tile host rendered":           inner.includes("app.plex.tv"),
    "Immich tile host rendered":         inner.includes("photos.zerotwosystems.com"),
    "request access CTA":                text.toLowerCase().includes("request access"),
    "lock indicator (locked)":           text.toLowerCase().includes("locked"),
    "terminal button":                   text.toLowerCase().includes("terminal"),
    "NEXUS-SH console in DOM":           text.includes("NEXUS-SH"),
    "search input present":              !!doc.querySelector(".search input"),
    "service tiles >= 8":                doc.querySelectorAll(".tile").length >= 8,
    "NODES ONLINE counter":              text.toUpperCase().includes("NODES ONLINE"),
    "window.sha256hex() defined":        typeof dom.window.sha256hex === "function",
    "window.Terminal defined":           typeof dom.window.Terminal === "function",
    "window.requestApi defined":         typeof dom.window.requestApi === "object",
    "window.RequestPanel defined":       typeof dom.window.RequestPanel === "function",
  };
  let ok = true;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? "  PASS  " : "  FAIL  ") + k); if (!v) ok = false; }
  console.log("\n  tiles rendered: " + doc.querySelectorAll(".tile").length);

  // sha256("zerotwo") must equal the baked operator-key hash
  const want = "61d8dc87458a24eae39d74abb171656a42efcb999fdc38633770c1734b9295ea";
  const got = typeof dom.window.sha256hex === "function" ? dom.window.sha256hex("zerotwo") : "(no fn)";
  const hashOk = got === want;
  console.log("  sha256('zerotwo') matches baked key: " + hashOk + (hashOk ? "" : " (got " + got + ")"));
  if (!hashOk) ok = false;

  const realErrors = errors.filter((e) => !/no-net \(smoke test\)/.test(e));
  if (realErrors.length) { console.log("\nRUNTIME ERRORS:"); realErrors.forEach((e) => console.log("  " + e)); ok = false; }
  else console.log("\nNo runtime errors (benign fetch-rejection noise filtered).");

  console.log("\nRESULT: " + (ok ? "PASS" : "FAIL"));
  dom.window.close();
  process.exit(ok ? 0 : 1);
}, 800);
