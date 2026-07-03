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
  beforeParse(w) {
    w.__adminRequests = [];
    w.fetch = (url, init = {}) => {
      const href = String(url);
      if (href === "https://api.zerotwosystems.com/admin/requests") {
        w.__adminRequests.push({ url: href, init });
        const auth = init.headers && init.headers.Authorization;
        if (auth === "Bearer zerotwo") {
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ requests: [{ id: "r1", status: "pending", ts: Date.now() }] })) });
        }
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(JSON.stringify({ error: "unauthorized" })) });
      }
      return Promise.reject(new Error("no-net"));
    };
  },
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

  click(btnByText("terminal"));
  await delay(200);
  check("locked: clicking terminal opens auth gate", doc.querySelector(".modal.auth") && /authentication_required/.test(doc.body.textContent));

  let pw = doc.querySelector(".modal.auth input[type=password]");
  setValue(pw, "wrongkey");
  click([...doc.querySelectorAll(".modal.auth .m-foot .btn")].find((b) => /authenticate/i.test(b.textContent)));
  await delay(200);
  check("wrong key rejected (access denied)", /access denied/i.test(doc.body.textContent) && !doc.querySelector(".lock.open"));
  check("wrong key called admin requests", win.__adminRequests.some((r) => r.url.endsWith("/admin/requests") && r.init.method === "GET" && r.init.headers.Authorization === "Bearer wrongkey"));

  pw = doc.querySelector(".modal.auth input[type=password]");
  setValue(pw, "zerotwo");
  click([...doc.querySelectorAll(".modal.auth .m-foot .btn")].find((b) => /authenticate/i.test(b.textContent)));
  await delay(250);
  check("correct key unlocks -> OPERATOR badge", !!doc.querySelector(".lock.open") && /operator/i.test(doc.querySelector(".lock.open").textContent));
  check("auth modal dismissed after unlock", !doc.querySelector(".modal.auth"));
  check("terminal drawer opened (.term.open)", !!doc.querySelector(".term.open"));
  check("INBOX button appears for operator", [...doc.querySelectorAll(".topbar .btn")].some((b) => /inbox/i.test(b.textContent)));
  check("correct key sent raw to admin requests", win.__adminRequests.some((r) => r.url.endsWith("/admin/requests") && r.init.method === "GET" && r.init.headers.Authorization === "Bearer zerotwo"));

  const ti = doc.querySelector(".term-input");
  setValue(ti, "help"); enter(ti);
  await delay(150);
  check("console `help` lists commands", /available commands/i.test(doc.querySelector(".term-body").textContent));

  setValue(ti, "ls"); enter(ti);
  await delay(150);
  const tb = doc.querySelector(".term-body").textContent;
  check("console `ls` shows service table", /STATUS/.test(tb) && /Jellyfin/.test(tb));

  setValue(ti, "passwd hunter2"); enter(ti);
  await delay(150);
  check("console `passwd` does not hash operator keys", /backend only/i.test(doc.querySelector(".term-body").textContent));

  click([...doc.querySelectorAll(".topbar .btn")].find((b) => /request access/i.test(b.textContent)));
  await delay(200);
  check("request panel opens (public)", !!doc.querySelector(".sheet") && /one request per 24 hours/i.test(doc.body.textContent));
  check("request form has service select + username", !!doc.querySelector(".sheet select") && doc.querySelectorAll(".sheet .field").length >= 4);

  const lockBadge = doc.querySelector(".lock.open");
  if (lockBadge) click(lockBadge);
  await delay(150);
  check("clicking OPERATOR badge re-locks", !doc.querySelector(".lock.open"));

  let ok = true;
  for (const [n, v] of results) { console.log((v ? "  PASS  " : "  FAIL  ") + n); if (!v) ok = false; }
  const real = errors.filter((e) => !/no-net/.test(e));
  if (real.length) { console.log("\nRUNTIME ERRORS:"); real.forEach((e) => console.log("  " + e)); ok = false; }
  else console.log("\nNo runtime errors.");
  console.log("\nRESULT: " + (ok ? "PASS" : "FAIL"));
  dom.window.close();
  process.exit(ok ? 0 : 1);
})();
