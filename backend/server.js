#!/usr/bin/env node

"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const OPERATOR_KEY_SHA256 = (process.env.OPERATOR_KEY_SHA256 ||
  "01922ae6ef59603ba3777c8e139f02a9198dc149f85f038f8f058ba4607c8830").toLowerCase();

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 4 * 1024;          // 4 KB hard cap on request bodies
const MAX_PENDING = 500;            // refuse new requests beyond this (anti disk-fill)
const MAX_TOTAL = 5000;             // hard cap on stored rows
const MIN_FORM_MS = 1200;           // submitted faster than this == bot
const ALLOWED_SERVICES = ["jellyfin", "seerr", "immich", "navidrome", "nextcloud"];
const LIMITS = { username: 60, contact: 80, referral: 200, note: 500 };
const MAX_SERVICES_BODY = 512 * 1024;
const DATABASE_URL = process.env.DATABASE_URL || "";
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
const SEED_SERVICES = [
  { id: "jellyfin", name: "Jellyfin", category: "MEDIA", statusMode: "auto", icon: "", url: "https://fin.zerotwosystems.com/" },
  { id: "seerr", name: "Seerr", category: "MEDIA", statusMode: "auto", icon: "", url: "https://seerr.zerotwosystems.com/" },
  { id: "navidrome", name: "Navidrome", category: "MEDIA", statusMode: "auto", icon: "", url: "https://music.zerotwosystems.com/" },
  { id: "immich", name: "Immich", category: "MEDIA", statusMode: "auto", icon: "", url: "https://photos.zerotwosystems.com/" },
  { id: "truenas", name: "TrueNAS", category: "STORAGE & CLOUD", statusMode: "off", icon: "", url: "" },
  { id: "nextcloud", name: "Nextcloud", category: "STORAGE & CLOUD", statusMode: "auto", icon: "", url: "https://cloud.zerotwosystems.com/" },
  { id: "porttracker", name: "Porttracker", category: "NETWORK & AUTOMATION", statusMode: "off", icon: "", url: "" },
  { id: "homeassistant", name: "Home Assistant", category: "NETWORK & AUTOMATION", statusMode: "auto", icon: "", url: "https://home.zerotwosystems.com/" },
];
const DEFAULT_OPERATOR_KEY_SHA256 = "01922ae6ef59603ba3777c8e139f02a9198dc149f85f038f8f058ba4607c8830";

const CORS_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = req.headers["origin"];
  if (!origin || !CORS_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

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

function pruneRate() {
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(rate)) {
    if (now - rate[k] > DAY_MS) { delete rate[k]; changed = true; }
  }
  if (changed) saveJSON(RATE_FILE, rate);
}
setInterval(pruneRate, 60 * 60 * 1000).unref();

function clientIP(req) {
  const cf = req.headers["cf-connecting-ip"];      // Cloudflare Tunnel / proxy
  if (cf) return String(cf).trim();
  const xr = req.headers["x-real-ip"];             // nginx proxy_set_header
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
    "X-Content-Type-Options": "nosniff",
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
  const a = Buffer.from(hash);
  const b = Buffer.from(OPERATOR_KEY_SHA256);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readBody(req, maxBody = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBody) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function str(v, max) { return (typeof v === "string" ? v : "").trim().slice(0, max); }

function dbRequired(res) {
  if (db) return true;
  send(res, 503, { ok: false, error: "database_not_configured" });
  return false;
}
function toApiService(row) {
  return {
    id: row.id, name: row.name, url: row.url, category: row.category, statusMode: row.status_mode,
    icon: row.icon_text || "", iconText: row.icon_text || "", iconUrl: row.icon_url || "",
    iconDataUrl: row.icon_data_url || "", sortOrder: row.sort_order, hidden: !!row.hidden,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function cleanNullableString(v, max, field, errors) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") { errors.push(field + " must be a string"); return null; }
  const out = v.trim();
  if (out.length > max) errors.push(field + " is too long");
  return out.slice(0, max);
}
function validateServices(payload) {
  const input = Array.isArray(payload && payload.services) ? payload.services : null;
  const errors = [];
  if (!input) return { errors: ["services must be an array"] };
  if (input.length > 1000) errors.push("services may not contain more than 1000 entries");
  const seen = new Set();
  const services = input.map((svc, i) => {
    if (!svc || typeof svc !== "object" || Array.isArray(svc)) { errors.push(`services[${i}] must be an object`); return null; }
    const id = cleanNullableString(svc.id, 120, `services[${i}].id`, errors);
    const name = cleanNullableString(svc.name, 200, `services[${i}].name`, errors);
    let url = "";
    if (typeof svc.url === "string") url = svc.url.trim().slice(0, 2048);
    else errors.push(`services[${i}].url must be a string`);
    const category = cleanNullableString(svc.category || "OTHER", 120, `services[${i}].category`, errors) || "OTHER";
    const statusMode = cleanNullableString(svc.statusMode || svc.status_mode || "auto", 40, `services[${i}].statusMode`, errors) || "auto";
    if (!id) errors.push(`services[${i}].id is required`);
    if (id && seen.has(id)) errors.push(`services[${i}].id is duplicated`);
    if (id) seen.add(id);
    if (!name) errors.push(`services[${i}].name is required`);
    return {
      id, name, url: url || "", category, status_mode: statusMode,
      icon_text: cleanNullableString(svc.iconText ?? svc.icon_text ?? svc.icon, 80, `services[${i}].iconText`, errors),
      icon_url: cleanNullableString(svc.iconUrl ?? svc.icon_url, 2048, `services[${i}].iconUrl`, errors),
      icon_data_url: cleanNullableString(svc.iconDataUrl ?? svc.icon_data_url, 1024 * 128, `services[${i}].iconDataUrl`, errors),
      sort_order: i, hidden: !!svc.hidden,
    };
  }).filter(Boolean);
  return { services, errors };
}
async function syncServices(services, missingMode) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const svc of services) {
      await client.query(`INSERT INTO dashboard_services
        (id, name, url, category, status_mode, icon_text, icon_url, icon_data_url, sort_order, hidden, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, category=EXCLUDED.category,
          status_mode=EXCLUDED.status_mode, icon_text=EXCLUDED.icon_text, icon_url=EXCLUDED.icon_url,
          icon_data_url=EXCLUDED.icon_data_url, sort_order=EXCLUDED.sort_order, hidden=EXCLUDED.hidden, updated_at=now()`,
        [svc.id, svc.name, svc.url, svc.category, svc.status_mode, svc.icon_text, svc.icon_url, svc.icon_data_url, svc.sort_order, svc.hidden]);
    }
    const ids = services.map((svc) => svc.id);
    if (missingMode === "hide") await client.query("UPDATE dashboard_services SET hidden = true, updated_at = now() WHERE NOT (id = ANY($1::text[]))", [ids]);
    else await client.query("DELETE FROM dashboard_services WHERE NOT (id = ANY($1::text[]))", [ids]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  return listServices(true);
}
async function initServicesDb() {
  if (!db) { console.warn("[zerotwo-requests] WARNING: DATABASE_URL is not set; /services API is unavailable."); return; }
  await db.query(`CREATE TABLE IF NOT EXISTS dashboard_services (
    id text PRIMARY KEY, name text NOT NULL, url text NOT NULL, category text NOT NULL DEFAULT 'OTHER',
    status_mode text NOT NULL DEFAULT 'auto', icon_text text, icon_url text, icon_data_url text,
    sort_order integer NOT NULL DEFAULT 0, hidden boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const count = await db.query("SELECT count(*)::int AS count FROM dashboard_services");
  if (count.rows[0].count === 0) await syncServices(validateServices({ services: SEED_SERVICES }).services, "delete");
}
async function listServices(includeHidden = false) {
  const result = await db.query(`SELECT * FROM dashboard_services ${includeHidden ? "" : "WHERE hidden = false"} ORDER BY sort_order ASC, name ASC`);
  return result.rows.map(toApiService);
}
async function handleGetServices(req, res) {
  if (!dbRequired(res)) return;
  try { return send(res, 200, { ok: true, services: await listServices(false) }); }
  catch (e) { console.error("[services] list failed", e); return send(res, 500, { ok: false, error: "database_error" }); }
}
async function handlePutServices(req, res) {
  if (!authed(req)) return send(res, 401, { ok: false, error: "unauthorized" });
  if (!dbRequired(res)) return;
  const contentType = String(req.headers["content-type"] || "");
  if (contentType && !contentType.toLowerCase().includes("application/json")) return send(res, 415, { ok: false, error: "unsupported_media_type" });
  let body;
  try { body = JSON.parse(await readBody(req, MAX_SERVICES_BODY) || "{}"); } catch (e) { return send(res, e.message === "too_large" ? 413 : 400, { ok: false, error: e.message === "too_large" ? "too_large" : "bad_json" }); }
  const { services, errors } = validateServices(body);
  if (errors.length) return send(res, 400, { ok: false, error: "validation_failed", errors });
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const missingMode = body.missing === "hide" || parsedUrl.searchParams.get("missing") === "hide" ? "hide" : "delete";
  try { return send(res, 200, { ok: true, services: await syncServices(services, missingMode), missing: missingMode }); }
  catch (e) { console.error("[services] sync failed", e); return send(res, 500, { ok: false, error: "database_error" }); }
}

async function handleSubmit(req, res) {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return send(res, 415, { ok: false, error: "unsupported_media_type" });
  }

  let raw;
  try { raw = await readBody(req); } catch (e) { return send(res, 413, { ok: false, error: "too_large" }); }

  let body;
  try { body = JSON.parse(raw || "{}"); } catch (e) { return send(res, 400, { ok: false, error: "bad_json" }); }

  if (str(body.website, 100)) return send(res, 200, { ok: true });           // honeypot filled
  if (typeof body.elapsed === "number" && body.elapsed < MIN_FORM_MS)
    return send(res, 200, { ok: true });                                     // submitted too fast

  const service = str(body.service, 30).toLowerCase();
  if (!ALLOWED_SERVICES.includes(service)) return send(res, 400, { ok: false, error: "bad_service" });
  const username = str(body.username, LIMITS.username);
  const contact = str(body.contact, LIMITS.contact);
  if (!username || !contact) return send(res, 400, { ok: false, error: "missing_fields" });

  const pending = requests.filter((r) => r.status === "pending").length;
  if (pending >= MAX_PENDING || requests.length >= MAX_TOTAL)
    return send(res, 503, { ok: false, error: "queue_full" });

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
  const contentType = String(req.headers["content-type"] || "");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return send(res, 415, { ok: false, error: "unsupported_media_type" });
  }

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

const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = (req.url || "").split("?")[0];
  if (req.method === "GET" && url === "/api/request") {
    return send(res, 200, { ok: true, services: ALLOWED_SERVICES, limits: LIMITS });
  }
  if (req.method === "GET" && url === "/services") return handleGetServices(req, res);
  if (req.method === "PUT" && url === "/admin/services") return handlePutServices(req, res);
  if (req.method === "POST" && url === "/api/request") return handleSubmit(req, res);
  if (req.method === "GET" && url === "/api/requests") return handleList(req, res);
  if (req.method === "POST" && url === "/api/request/resolve") return handleResolve(req, res);
  if (req.method === "GET" && url === "/api/health") {
    return send(res, 200, {
      ok: true,
      service: "zerotwo-requests",
      pending: requests.filter((r) => r.status === "pending").length,
      total: requests.length,
    });
  }
  return send(res, 404, { ok: false, error: "not_found" });
});

initServicesDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`[zerotwo-requests] listening on http://${HOST}:${PORT}`);
    console.log(`[zerotwo-requests] data dir: ${DATA_DIR}`);
    if (OPERATOR_KEY_SHA256 === DEFAULT_OPERATOR_KEY_SHA256)
      console.warn("[zerotwo-requests] WARNING: using DEFAULT operator key hash. Set OPERATOR_KEY_SHA256.");
  });
}).catch((error) => {
  console.error("[zerotwo-requests] database startup failed", error);
  process.exit(1);
});
