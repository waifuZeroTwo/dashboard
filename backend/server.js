#!/usr/bin/env node
/* ============================================================================
 * ZeroTwo Systems — account-request backend (zero dependencies)
 * ----------------------------------------------------------------------------
 * A tiny HTTP service that:
 *   - accepts POST /api/request from the public dashboard
 *   - enforces ONE request per IP per rolling 24h (the real guarantee)
 *   - blocks bots: honeypot field, minimum form time, strict size/field caps
 *   - caps total pending requests so disk can never be filled
 *   - exposes GET /api/requests and POST /api/request/resolve for the operator,
 *     authenticated by the SHA-256 of the operator passphrase (same hash the
 *     dashboard uses) — no plaintext stored anywhere
 *
 * Run it on localhost behind nginx (see nginx.conf.example). nginx terminates
 * TLS, applies edge rate-limiting (limit_req) so a flood never reaches Node,
 * and forwards the real client IP via X-Real-IP.
 *
 *   OPERATOR_KEY_SHA256=<hash> PORT=8787 DATA_DIR=./data node server.js
 *
 * Generate the hash with:  printf '%s' 'your passphrase' | shasum -a 256
 * (or run `passwd <phrase>` in the dashboard console).
 * ========================================================================== */

"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---- config ----------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const OPERATOR_KEY_SHA256 = (process.env.OPERATOR_KEY_SHA256 ||
  // default = sha256("zerotwo"); CHANGE THIS via env var in production
  "61d8dc87458a24eae39d74abb171656a42efcb999fdc38633770c1734b9295ea").toLowerCase();

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 4 * 1024;          // 4 KB hard cap on request bodies
const MAX_PENDING = 500;            // refuse new requests beyond this (anti disk-fill)
const MAX_TOTAL = 5000;             // hard cap on stored rows
const MIN_FORM_MS = 1200;           // submitted faster than this == bot
const ALLOWED_SERVICES = ["jellyfin", "plex", "immich", "navidrome", "nextcloud"];
const LIMITS = { username: 60, contact: 80, referral: 200, note: 500 };

// ---- storage (flat JSON files, atomic writes) ------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const REQ_FILE = path.join(DATA_DIR, "requests.json");
const RATE_FILE = path.join(DATA_DIR, "ratelimit.json");

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function saveJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);           // atomic on the same filesystem
}

let requests = loadJSON(REQ_FILE, []);  // [{id, service, username, contact, referral, note, ip, ts, status}]
let rate = loadJSON(RATE_FILE, {});     // { "<ipHash>": lastTs }

// periodically prune old rate entries so the map can't grow unbounded
function pruneRate() {
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(rate)) {
    if (now - rate[k] > DAY_MS) { delete rate[k]; changed = true; }
  }
  if (changed) saveJSON(RATE_FILE, rate);
}
setInterval(pruneRate, 60 * 60 * 1000).unref();

// ---- helpers ---------------------------------------------------------------
function clientIP(req) {
  const xr = req.headers["x-real-ip"];
  if (xr) return String(xr).trim();
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
function ipHash(ip) { return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24); }
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function authed(req) {
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  // constant-time compare
  const a = Buffer.from(hash);
  const b = Buffer.from(OPERATOR_KEY_SHA256);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function str(v, max) { return (typeof v === "string" ? v : "").trim().slice(0, max); }

// ---- handlers --------------------------------------------------------------
async function handleSubmit(req, res) {
  let raw;
  try { raw = await readBody(req); } catch (e) { return send(res, 413, { ok: false, error: "too_large" }); }

  let body;
  try { body = JSON.parse(raw || "{}"); } catch (e) { return send(res, 400, { ok: false, error: "bad_json" }); }

  // bot traps — look like success, store nothing
  if (str(body.website, 100)) return send(res, 200, { ok: true });           // honeypot filled
  if (typeof body.elapsed === "number" && body.elapsed < MIN_FORM_MS)
    return send(res, 200, { ok: true });                                     // submitted too fast

  // validate
  const service = str(body.service, 30).toLowerCase();
  if (!ALLOWED_SERVICES.includes(service)) return send(res, 400, { ok: false, error: "bad_service" });
  const username = str(body.username, LIMITS.username);
  const contact = str(body.contact, LIMITS.contact);
  if (!username || !contact) return send(res, 400, { ok: false, error: "missing_fields" });

  // capacity guard (never let the store grow without bound)
  const pending = requests.filter((r) => r.status === "pending").length;
  if (pending >= MAX_PENDING || requests.length >= MAX_TOTAL)
    return send(res, 503, { ok: false, error: "queue_full" });

  // per-IP rolling 24h limit — THE real enforcement
  const ip = clientIP(req);
  const key = ipHash(ip);
  const now = Date.now();
  const last = rate[key] || 0;
  if (now - last < DAY_MS) {
    const retryAfter = Math.ceil((DAY_MS - (now - last)) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return send(res, 429, { ok: false, error: "rate_limited", retryAfter });
  }

  const entry = {
    id: crypto.randomBytes(8).toString("hex"),
    service, username, contact,
    referral: str(body.referral, LIMITS.referral),
    note: str(body.note, LIMITS.note),
    ip, ts: now, status: "pending",
  };
  requests.push(entry);
  rate[key] = now;
  saveJSON(REQ_FILE, requests);
  saveJSON(RATE_FILE, rate);
  return send(res, 200, { ok: true, id: entry.id });
}

function handleList(req, res) {
  if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
  return send(res, 200, { ok: true, requests });
}

async function handleResolve(req, res) {
  if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
  let body;
  try { body = JSON.parse(await readBody(req) || "{}"); } catch (e) { return send(res, 400, { ok: false }); }
  const { id, action } = body;
  if (action === "delete") {
    requests = requests.filter((r) => r.id !== id);
  } else if (action === "approve" || action === "deny") {
    const r = requests.find((x) => x.id === id);
    if (r) r.status = action === "approve" ? "approved" : "denied";
  } else {
    return send(res, 400, { ok: false, error: "bad_action" });
  }
  saveJSON(REQ_FILE, requests);
  return send(res, 200, { ok: true });
}

// ---- router ----------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  if (req.method === "POST" && url === "/api/request") return handleSubmit(req, res);
  if (req.method === "GET" && url === "/api/requests") return handleList(req, res);
  if (req.method === "POST" && url === "/api/request/resolve") return handleResolve(req, res);
  if (req.method === "GET" && url === "/api/health") return send(res, 200, { ok: true });
  return send(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[zerotwo-requests] listening on http://${HOST}:${PORT}`);
  console.log(`[zerotwo-requests] data dir: ${DATA_DIR}`);
  if (OPERATOR_KEY_SHA256 === "61d8dc87458a24eae39d74abb171656a42efcb999fdc38633770c1734b9295ea")
    console.warn("[zerotwo-requests] WARNING: using DEFAULT operator key (sha256 of 'zerotwo'). Set OPERATOR_KEY_SHA256.");
});
