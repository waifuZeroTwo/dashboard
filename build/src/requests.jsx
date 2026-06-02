/* ============================================================
   ZeroTwo Systems — account request system
   RequestPanel (public, soft rate-limit)
   OperatorRequests (operator-gated inbox)
   api layer: tries the real backend, falls back to a clearly
   labelled localStorage "demo" store when no backend is present.
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;

const REQ_SERVICES = ["jellyfin", "plex", "immich", "navidrome", "nextcloud"];
const DAY_MS = 24 * 60 * 60 * 1000;
const SOFT_KEY = "zerotwo.req.last.v1";       // client soft-limit timestamp
const DEMO_STORE = "zerotwo.requests.demo.v1"; // demo inbox

/* ---------- client soft-limit (cookie + localStorage) ---------- */
function setCookie(name, val, ms) {
  try {
    const exp = new Date(Date.now() + ms).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(val)}; expires=${exp}; path=/; SameSite=Strict`;
  } catch (e) {}
}
function getCookie(name) {
  try {
    return document.cookie.split("; ").reduce((a, c) => {
      const [k, v] = c.split("=");
      return k === name ? decodeURIComponent(v || "") : a;
    }, "");
  } catch (e) { return ""; }
}
function lastRequestAt() {
  let t = 0;
  try { t = parseInt(localStorage.getItem(SOFT_KEY) || "0", 10) || 0; } catch (e) {}
  const c = parseInt(getCookie("zt_req") || "0", 10) || 0;
  return Math.max(t, c);
}
function markRequested() {
  const now = Date.now();
  try { localStorage.setItem(SOFT_KEY, String(now)); } catch (e) {}
  setCookie("zt_req", String(now), DAY_MS);
}

/* ---------- demo store ---------- */
function demoList() {
  try { return JSON.parse(localStorage.getItem(DEMO_STORE) || "[]"); } catch (e) { return []; }
}
function demoSave(arr) { try { localStorage.setItem(DEMO_STORE, JSON.stringify(arr)); } catch (e) {} }

/* ---------- api ---------- */
function isAbsent(status) { return status === 404 || status === 405 || status === 501 || status === 502; }

function demoSubmit(payload) {
  const arr = demoList();
  arr.unshift({
    id: "demo_" + Date.now().toString(36),
    ...payload, ip: "demo", ts: Date.now(), status: "pending",
  });
  demoSave(arr);
  return { ok: true, demo: true };
}
function demoResolve(id, action) {
  let arr = demoList();
  if (action === "delete") arr = arr.filter((x) => x.id !== id);
  else arr = arr.map((x) => x.id === id ? { ...x, status: action === "approve" ? "approved" : "denied" } : x);
  demoSave(arr);
  return { ok: true, demo: true };
}

const api = {
  async submit(payload) {
    try {
      const r = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isAbsent(r.status)) return demoSubmit(payload);   // no backend present
      if (r.status === 429) { const j = await r.json().catch(() => ({})); return { ok: false, rate: true, retryAfter: j.retryAfter || DAY_MS / 1000 }; }
      if (r.status === 503) return { ok: false, busy: true };
      if (!r.ok) return { ok: false, error: true };
      const j = await r.json().catch(() => ({}));
      return { ok: true, id: j.id };
    } catch (e) {
      return demoSubmit(payload);                            // fetch threw → demo
    }
  },
  async list(key) {
    try {
      const r = await fetch("/api/requests", { headers: { Authorization: "Bearer " + (key || "") } });
      if (isAbsent(r.status)) return { ok: true, demo: true, requests: demoList() };
      if (r.status === 401) return { ok: false, unauth: true };
      if (!r.ok) return { ok: false };
      const j = await r.json();
      return { ok: true, requests: j.requests || [] };
    } catch (e) {
      return { ok: true, demo: true, requests: demoList() };
    }
  },
  async resolve(key, id, action) {
    try {
      const r = await fetch("/api/request/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (key || "") },
        body: JSON.stringify({ id, action }),
      });
      if (isAbsent(r.status)) return demoResolve(id, action);
      return { ok: r.ok };
    } catch (e) {
      return demoResolve(id, action);
    }
  },
};

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function fmtCountdown(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ============================================================
   Public request panel
   ============================================================ */
function RequestPanel({ open, onClose }) {
  const blank = { service: "", username: "", contact: "", referral: "", note: "" };
  const [f, setF] = useState(blank);
  const [hp, setHp] = useState("");           // honeypot
  const [errs, setErrs] = useState({});
  const [state, setState] = useState("form"); // form | done | blocked | busy
  const [demo, setDemo] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    setF(blank); setHp(""); setErrs({}); setDemo(false);
    const last = lastRequestAt();
    const rem = last + DAY_MS - Date.now();
    if (rem > 0) { setRemaining(rem); setState("blocked"); }
    else setState("form");
  }, [open]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const validate = () => {
    const e = {};
    if (!f.service) e.service = "pick a service";
    if (!f.username.trim()) e.username = "required";
    if (!f.contact.trim()) e.contact = "we need a way to reach you";
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    // client soft-limit re-check
    const last = lastRequestAt();
    if (last + DAY_MS - Date.now() > 0) { setRemaining(last + DAY_MS - Date.now()); setState("blocked"); return; }
    // honeypot / too-fast → silently accept-looking, never sent
    if (hp || Date.now() - openedAt.current < 1200) { markRequested(); setState("done"); return; }

    const payload = {
      service: f.service,
      username: f.username.trim().slice(0, 60),
      contact: f.contact.trim().slice(0, 80),
      referral: f.referral.trim().slice(0, 200),
      note: f.note.trim().slice(0, 500),
      website: hp,           // honeypot field name
      elapsed: Date.now() - openedAt.current,
    };
    const res = await api.submit(payload);
    if (res.ok) { markRequested(); setDemo(!!res.demo); setState("done"); }
    else if (res.rate) { setRemaining((res.retryAfter || 0) * 1000); setState("blocked"); }
    else if (res.busy) setState("busy");
    else setErrs({ form: "something went wrong — try again later." });
  };

  if (!open) return null;

  return (
    <div className="sheet-back" onMouseDown={onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <div className="st">request access</div>
            <div className="ss">ask the operator for an account</div>
          </div>
          <span className="spacer"></span>
          <span className="x" onClick={onClose}>✕</span>
        </div>

        {state === "form" && (
          <React.Fragment>
            <div className="sheet-body">
              <div className="notice">
                <span className="nh">▮ one request per 24 hours</span>
                You can submit <b>one</b> account request per day. Repeat or automated
                submissions are blocked per-IP at the server and won't be delivered.
              </div>

              <div className="field">
                <label>service <span className="req-mark">*</span></label>
                <select value={f.service} onChange={(e) => set("service", e.target.value)}>
                  <option value="">— select a service —</option>
                  {REQ_SERVICES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
                {errs.service && <div className="err-msg">{errs.service}</div>}
              </div>

              <div className="field">
                <label>desired username <span className="req-mark">*</span></label>
                <input value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="the_username_you_want" maxLength={60} />
                {errs.username && <div className="err-msg">{errs.username}</div>}
              </div>

              <div className="field">
                <label>contact — discord / telegram <span className="req-mark">*</span></label>
                <input value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="@handle" maxLength={80} />
                {errs.contact && <div className="err-msg">{errs.contact}</div>}
              </div>

              <div className="field">
                <label>how do you know me?</label>
                <input value={f.referral} onChange={(e) => set("referral", e.target.value)} placeholder="invite code, or who referred you" maxLength={200} />
              </div>

              <div className="field">
                <label>note (optional)</label>
                <textarea value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="anything else the operator should know…" maxLength={500} />
              </div>

              {/* honeypot — humans never see this */}
              <div className="honeypot" aria-hidden="true">
                <label>Website</label>
                <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
              </div>

              {errs.form && <div className="err-msg">{errs.form}</div>}
            </div>
            <div className="sheet-foot">
              <button className="btn" onClick={onClose}>cancel</button>
              <button className="btn on" onClick={submit}>submit request</button>
            </div>
          </React.Fragment>
        )}

        {state === "blocked" && (
          <div className="sheet-body">
            <div className="notice req-block">
              <span className="nh">✕ already requested</span>
              You've already submitted a request in the last 24 hours. The limit is
              <b> one per day</b>. Please try again in <b>{fmtCountdown(remaining)}</b>.
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              If this is urgent, reach the operator directly through whatever channel you
              already have — this form is only for first contact.
            </p>
          </div>
        )}

        {state === "busy" && (
          <div className="sheet-body">
            <div className="notice req-block">
              <span className="nh">✕ queue full</span>
              The request queue is temporarily full. Please try again later.
            </div>
          </div>
        )}

        {state === "done" && (
          <div className="sheet-body">
            <div className="req-done">
              <div className="big">✓</div>
              <h3>request received</h3>
              <p>The operator will review it and reach out via the contact you provided.<br />No account is created automatically.</p>
              <div className="when">next request available in 24h</div>
              {demo && <div style={{ marginTop: 16 }}><span className="demo-tag">● demo mode — backend not connected</span></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Operator inbox (gated)
   ============================================================ */
function OperatorRequests({ open, operatorKey, onClose, onCount }) {
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [unauth, setUnauth] = useState(false);
  const [filter, setFilter] = useState("pending");

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await api.list(operatorKey);
    setLoading(false);
    if (res.unauth) { setUnauth(true); setReqs([]); return; }
    setUnauth(false);
    setDemo(!!res.demo);
    const list = (res.requests || []).slice().sort((a, b) => b.ts - a.ts);
    setReqs(list);
    if (onCount) onCount(list.filter((r) => r.status === "pending").length);
  }, [operatorKey, onCount]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  const act = async (id, action) => {
    await api.resolve(operatorKey, id, action);
    reload();
  };

  if (!open) return null;

  const shown = reqs.filter((r) => filter === "all" ? true : r.status === (filter === "pending" ? "pending" : filter));
  const pendingN = reqs.filter((r) => r.status === "pending").length;

  return (
    <div className="sheet-back" onMouseDown={onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <div className="st">requests inbox</div>
            <div className="ss">{pendingN} pending · operator only</div>
          </div>
          <span className="spacer"></span>
          {demo && <span className="demo-tag">● demo</span>}
          <span className="x" onClick={onClose}>✕</span>
        </div>

        <div className="sheet-body">
          <div className="statuspick" style={{ marginBottom: 4 }}>
            {["pending", "approved", "denied", "all"].map((k) => (
              <button key={k} className={filter === k ? "sel" : ""} onClick={() => setFilter(k)}>{k}</button>
            ))}
          </div>

          {loading && <div className="req-empty">loading…</div>}
          {!loading && unauth && <div className="req-empty">unauthorized — operator key rejected by backend.</div>}
          {!loading && !unauth && shown.length === 0 && (
            <div className="req-empty">no {filter === "all" ? "" : filter} requests.</div>
          )}

          {!loading && !unauth && shown.map((r) => (
            <div className={"req-card s-" + r.status} key={r.id}>
              <div className="rc-top">
                <span className="svc-tag">{r.service}</span>
                <span className="rc-status">{r.status}</span>
                <span className="rc-time">{relTime(r.ts)}</span>
              </div>
              <div className="rc-row"><span className="k">username</span><span className="v">{r.username || "—"}</span></div>
              <div className="rc-row"><span className="k">contact</span><span className="v">{r.contact || "—"}</span></div>
              {r.referral && <div className="rc-row"><span className="k">referral</span><span className="v">{r.referral}</span></div>}
              {r.ip && r.ip !== "demo" && <div className="rc-row"><span className="k">ip</span><span className="v">{r.ip}</span></div>}
              {r.note && <div className="rc-note">{r.note}</div>}
              <div className="rc-actions">
                {r.status !== "approved" && <button className="btn on" onClick={() => act(r.id, "approve")}>approve</button>}
                {r.status !== "denied" && <button className="btn" onClick={() => act(r.id, "deny")}>deny</button>}
                <button className="btn danger" onClick={() => act(r.id, "delete")}>delete</button>
              </div>
            </div>
          ))}
        </div>

        <div className="sheet-foot">
          {demo && <span style={{ color: "var(--muted)", fontSize: 11, marginRight: "auto" }}>demo store (localStorage) — real data appears once the backend is deployed</span>}
          <button className="btn" onClick={reload}>refresh</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { RequestPanel, OperatorRequests, requestApi: api, pendingCount: () => demoList().filter((r) => r.status === "pending").length });
