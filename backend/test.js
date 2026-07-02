#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORT = 18987;
const HOST = "127.0.0.1";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zerotwo-backend-test-"));
const OPERATOR_KEY = "test operator key";
const OPERATOR_HASH = crypto.createHash("sha256").update(OPERATOR_KEY).digest("hex");
const ORIGIN = "https://dashboard.example";
const BAD_ORIGIN = "https://attacker.example";

const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: {
    ...process.env,
    HOST,
    PORT: String(PORT),
    DATA_DIR,
    CORS_ORIGIN: ORIGIN,
    OPERATOR_KEY_SHA256: OPERATOR_HASH,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

function request(method, urlPath, { headers = {}, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const reqHeaders = { ...headers };
    if (origin) reqHeaders.Origin = origin;
    if (data !== null) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(data);
    }
    const req = http.request({ host: HOST, port: PORT, method, path: urlPath, headers: reqHeaders }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

function waitReady() {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error("server did not become ready")), 5000);
    child.stdout.on("data", (chunk) => {
      if (/listening/.test(String(chunk))) finish(resolve);
    });
    child.on("exit", (code) => finish(reject, new Error(`server exited early with code ${code}`)));
  });
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: !!pass, detail });
}

(async () => {
  await waitReady();

  let res = await request("GET", "/api/health");
  check("health endpoint returns ok", res.status === 200 && res.json && res.json.ok === true, `${res.status} ${res.raw}`);

  res = await request("GET", "/api/request");
  check("request capability endpoint returns allowed services", res.status === 200 && Array.isArray(res.json.services) && res.json.services.includes("jellyfin"), `${res.status} ${res.raw}`);

  res = await request("OPTIONS", "/api/request", { origin: ORIGIN, headers: { "Access-Control-Request-Method": "POST" } });
  check("CORS preflight succeeds for allowed origin", res.status === 204 && res.headers["access-control-allow-origin"] === ORIGIN, `${res.status} ${JSON.stringify(res.headers)}`);

  res = await request("OPTIONS", "/api/request", { origin: BAD_ORIGIN });
  check("CORS preflight does not allow unknown origins", res.status === 204 && !res.headers["access-control-allow-origin"], `${res.status} ${JSON.stringify(res.headers)}`);

  res = await request("POST", "/api/request", { origin: ORIGIN, body: { service: "jellyfin", username: "neo", contact: "neo@example.com", elapsed: 2500 } });
  const firstId = res.json && res.json.id;
  check("valid request is accepted", res.status === 200 && res.json && res.json.ok === true && firstId, `${res.status} ${res.raw}`);
  check("accepted request includes CORS header", res.headers["access-control-allow-origin"] === ORIGIN, JSON.stringify(res.headers));

  res = await request("POST", "/api/request", { origin: ORIGIN, body: { service: "seerr", username: "neo2", contact: "neo2@example.com", elapsed: 2500 } });
  check("same client is rate limited", res.status === 429 && res.json && res.json.error === "rate_limited", `${res.status} ${res.raw}`);

  res = await request("POST", "/api/request", { headers: { "CF-Connecting-IP": "203.0.113.11" }, body: { service: "unknown", username: "bad", contact: "bad@example.com", elapsed: 2500 } });
  check("invalid service is rejected", res.status === 400 && res.json && res.json.error === "bad_service", `${res.status} ${res.raw}`);

  res = await request("POST", "/api/request", { headers: { "CF-Connecting-IP": "203.0.113.12" }, body: { service: "immich", username: "bot", contact: "bot@example.com", website: "filled", elapsed: 2500 } });
  check("honeypot submission is quietly accepted without storing", res.status === 200 && res.json && res.json.ok === true && !res.json.id, `${res.status} ${res.raw}`);

  res = await request("GET", "/api/requests", { headers: { Authorization: "Bearer wrong" } });
  check("operator list rejects wrong key", res.status === 401, `${res.status} ${res.raw}`);

  res = await request("GET", "/api/requests", { headers: { Authorization: `Bearer ${OPERATOR_KEY}` } });
  check("operator list returns stored requests", res.status === 200 && res.json.requests.length === 1 && res.json.requests[0].id === firstId, `${res.status} ${res.raw}`);
  check("request file was persisted", fs.existsSync(path.join(DATA_DIR, "requests.json")), DATA_DIR);

  res = await request("POST", "/api/request/resolve", { headers: { Authorization: `Bearer ${OPERATOR_KEY}` }, body: { id: firstId, action: "approve" } });
  check("operator can approve a request", res.status === 200 && res.json && res.json.ok === true, `${res.status} ${res.raw}`);

  res = await request("GET", "/api/requests", { headers: { Authorization: `Bearer ${OPERATOR_KEY}` } });
  check("approved status is saved", res.status === 200 && res.json.requests[0].status === "approved", `${res.status} ${res.raw}`);

  let ok = true;
  for (const result of checks) {
    if (!result.pass) ok = false;
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.pass || !result.detail ? "" : ` (${result.detail})`}`);
  }
  console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
  child.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  child.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(1);
});
