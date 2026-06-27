"use strict";
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const PORT = 8799;
const PAGE_ORIGIN = "https://zerotwosystems.nl";
const BAD_ORIGIN = "https://evil.example";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zerotwo-cors-"));
const KEY = "zerotwo";

const srv = spawn(process.execPath, [path.join(__dirname, "..", "backend", "server.js")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR, CORS_ORIGIN: PAGE_ORIGIN + ",https://zerotwosystems.com" },
  stdio: ["ignore", "pipe", "pipe"],
});

function req(method, p, { origin, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (origin) h["Origin"] = origin;
    if (data) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(data); }
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: h }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const results = [];
const check = (name, cond, extra) => { results.push([name, !!cond]); if (!cond && extra) console.log("    ↳ " + extra); };

function waitReady() {
  return new Promise((resolve) => {
    const onData = (c) => { if (/listening/.test(String(c))) { srv.stdout.off("data", onData); resolve(); } };
    srv.stdout.on("data", onData);
    setTimeout(resolve, 1500);
  });
}

(async () => {
  await waitReady();

  let r = await req("OPTIONS", "/api/request", { origin: PAGE_ORIGIN, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  check("preflight /api/request -> 204", r.status === 204, "status=" + r.status);
  check("preflight echoes Allow-Origin", r.headers["access-control-allow-origin"] === PAGE_ORIGIN, JSON.stringify(r.headers["access-control-allow-origin"]));
  check("preflight allows POST + OPTIONS", /POST/.test(r.headers["access-control-allow-methods"] || "") && /OPTIONS/.test(r.headers["access-control-allow-methods"] || ""));
  check("preflight allows Authorization + Content-Type headers", /authorization/i.test(r.headers["access-control-allow-headers"] || "") && /content-type/i.test(r.headers["access-control-allow-headers"] || ""));

  r = await req("OPTIONS", "/api/request", { origin: BAD_ORIGIN });
  check("disallowed origin -> no Allow-Origin header", !r.headers["access-control-allow-origin"], "got " + r.headers["access-control-allow-origin"]);

  r = await req("POST", "/api/request", { origin: PAGE_ORIGIN, body: { service: "jellyfin", username: "neo", contact: "@neo", elapsed: 5000 } });
  check("submit 200 (valid, allowed origin)", r.status === 200, "status=" + r.status + " body=" + r.body);
  check("submit response carries Allow-Origin", r.headers["access-control-allow-origin"] === PAGE_ORIGIN);

  r = await req("POST", "/api/request", { origin: PAGE_ORIGIN, body: { service: "plex", username: "trinity", contact: "@trin", elapsed: 5000 } });
  check("second submit same IP -> 429 (per-IP/day limit)", r.status === 429, "status=" + r.status);
  check("429 still has Allow-Origin (browser can read it)", r.headers["access-control-allow-origin"] === PAGE_ORIGIN);

  r = await req("GET", "/api/requests", { origin: PAGE_ORIGIN, headers: { Authorization: "Bearer wrongkey" } });
  check("inbox wrong key -> 401", r.status === 401, "status=" + r.status);
  check("401 carries Allow-Origin", r.headers["access-control-allow-origin"] === PAGE_ORIGIN);
  r = await req("GET", "/api/requests", { origin: PAGE_ORIGIN, headers: { Authorization: "Bearer " + KEY } });
  let list = []; try { list = JSON.parse(r.body).requests || []; } catch (e) {}
  check("inbox correct key -> 200 + lists the request", r.status === 200 && list.length === 1 && list[0].service === "jellyfin", "status=" + r.status + " n=" + list.length);

  r = await req("POST", "/api/request", { origin: PAGE_ORIGIN, headers: { "CF-Connecting-IP": "203.0.113.7" }, body: { service: "immich", username: "alpha", contact: "@a", elapsed: 5000 } });
  check("submit w/ fresh CF-Connecting-IP -> 200 (treated as new client)", r.status === 200, "status=" + r.status);
  r = await req("POST", "/api/request", { origin: PAGE_ORIGIN, headers: { "CF-Connecting-IP": "203.0.113.7" }, body: { service: "plex", username: "a2", contact: "@a2", elapsed: 5000 } });
  check("same CF-Connecting-IP again -> 429 (limit keyed on forwarded IP)", r.status === 429, "status=" + r.status);
  r = await req("POST", "/api/request", { origin: PAGE_ORIGIN, headers: { "CF-Connecting-IP": "198.51.100.42" }, body: { service: "navidrome", username: "beta", contact: "@b", elapsed: 5000 } });
  check("different CF-Connecting-IP -> 200 (independent bucket)", r.status === 200, "status=" + r.status);

  r = await req("GET", "/api/health");
  check("health -> 200", r.status === 200);

  let ok = true;
  console.log("");
  for (const [n, v] of results) { console.log((v ? "  PASS  " : "  FAIL  ") + n); if (!v) ok = false; }
  console.log("\nRESULT: " + (ok ? "PASS" : "FAIL"));
  srv.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
