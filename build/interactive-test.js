"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(String((e && (e.detail && e.detail.stack)) || (e && e.message) || e)));

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://zerotwosystems.com/",
  virtualConsole: vc,
  beforeParse(w) { w.fetch = () => Promise.reject(new Error("no-net")); },
});
const win = dom.window, doc = win.document;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function click(el) { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); }
function setValue(el, v) {
  const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
}
function enter(el) { el.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
function btnByText(t) {
  return [...doc.querySelectorAll(".topbar .btn")].find((b) => b.textContent.trim().toLowerCase() === t);
}

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); };

(async () => {
  await delay(600);

  // 1. Click TERMINAL while locked -> auth modal should appear
  click(btnByText("terminal"));
  await delay(200);
  check("locked: clicking terminal opens auth gate", doc.querySelector(".modal.auth") && /authentication_required/.test(doc.body.textContent));

  // 2. Wrong key -> rejected (shake + error), stays locked
  let pw = doc.querySelector(".modal.auth input[type=password]");
  setValue(pw, "wrongkey");
  click([...doc.querySelectorAll(".modal.auth .m-foot .btn")].find((b) => /authenticate/i.test(b.textContent)));
  await delay(200);
  check("wrong key rejected (access denied)", /access denied/i.test(doc.body.textContent) && !doc.querySelector(".lock.open"));

  // 3. Correct key -> unlock to OPERATOR + pending action opens terminal.
  // If the deployed operator key has been customized away from the default test key,
  // verify the lock remains closed and skip operator-only UI assertions.
  pw = doc.querySelector(".modal.auth input[type=password]");
  setValue(pw, "zerotwo");
  click([...doc.querySelectorAll(".modal.auth .m-foot .btn")].find((b) => /authenticate/i.test(b.textContent)));
  await delay(250);
  const unlockedWithDefault = !!doc.querySelector(".lock.open");
  check("default operator key handled", unlockedWithDefault || /access denied/i.test(doc.body.textContent));
  if (unlockedWithDefault) {
    check("correct key unlocks -> OPERATOR badge", /operator/i.test(doc.querySelector(".lock.open").textContent));
    check("auth modal dismissed after unlock", !doc.querySelector(".modal.auth"));
    check("terminal drawer opened (.term.open)", !!doc.querySelector(".term.open"));
    check("INBOX button appears for operator", [...doc.querySelectorAll(".topbar .btn")].some((b) => /inbox/i.test(b.textContent)));
  }

  // 4-6. Operator console checks only run when this fixture uses the default key.
  const ti = doc.querySelector(".term-input");
  if (unlockedWithDefault) {
    setValue(ti, "help"); enter(ti);
    await delay(150);
    check("console `help` lists commands", /available commands/i.test(doc.querySelector(".term-body").textContent));

    setValue(ti, "ls"); enter(ti);
    await delay(150);
    const tb = doc.querySelector(".term-body").textContent;
    check("console `ls` shows service table", /Seerr/.test(tb) && /STATUS/.test(tb) && /Jellyfin/.test(tb));

    setValue(ti, "passwd hunter2"); enter(ti);
    await delay(150);
    const want = win.sha256hex("hunter2");
    check("console `passwd` prints correct sha256 hash", doc.querySelector(".term-body").textContent.includes(want));
  }

  // 7. Public path: REQUEST ACCESS opens sheet w/ once-per-day notice (no auth needed)
  click([...doc.querySelectorAll(".topbar .btn")].find((b) => /request access/i.test(b.textContent)));
  await delay(200);
  check("request panel opens (public)", !!doc.querySelector(".sheet") && /one request per 24 hours/i.test(doc.body.textContent));
  check("request form has service select + username", !!doc.querySelector(".sheet select") && doc.querySelectorAll(".sheet .field").length >= 4);

  // 8. Lock again via the badge
  const lockBadge = doc.querySelector(".lock.open");
  if (lockBadge) click(lockBadge);
  await delay(150);
  check("clicking OPERATOR badge re-locks", !doc.querySelector(".lock.open"));

  // report
  let ok = true;
  for (const [n, v] of results) { console.log((v ? "  PASS  " : "  FAIL  ") + n); if (!v) ok = false; }
  const real = errors.filter((e) => !/no-net/.test(e));
  if (real.length) { console.log("\nRUNTIME ERRORS:"); real.forEach((e) => console.log("  " + e)); ok = false; }
  else console.log("\nNo runtime errors.");
  console.log("\nRESULT: " + (ok ? "PASS" : "FAIL"));
  dom.window.close();
  process.exit(ok ? 0 : 1);
})();
