
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const STORE_KEY = "zerotwo.nexus.v1";
const NEWTAB_KEY = "zerotwo.newtab.v1";
const UNLOCK_KEY = "zerotwo.unlocked.v1";

const OPERATOR_KEY_SHA256 = "61d8dc87458a24eae39d74abb171656a42efcb999fdc38633770c1734b9295ea";

const TITLE_CYCLE = [
    "HomeLab Nexus",
    "होमलैब नेक्सस",
    "ホームラボ・ネクサス",
    "家庭实验室枢纽",
    "محور المختبر المنزلي",
    "Узел домашней лаборатории",
    "홈랩 넥서스",
    "ศูนย์กลางโฮมแล็บ",
    "Kitovu cha Maabara ya Nyumbani",
    "Kotilaboratorion Solmukohta",
];

const SEERR_URL = "https://seerr.zerotwosystems.com/";
const JELLYFIN_URL = "https://fin.zerotwosystems.com/";

const SEED = [
  { id: "jellyfin",  name: "Jellyfin",      category: "MEDIA",  statusMode: "auto", icon: "",
    url: JELLYFIN_URL },
  { id: "seerr",     name: "Seerr",         category: "MEDIA",  statusMode: "auto", icon: "",
    url: SEERR_URL },
  { id: "navidrome", name: "Navidrome",     category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://music.zerotwosystems.com/" },
  { id: "immich",    name: "Immich",        category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://photos.zerotwosystems.com/" },
  { id: "truenas",   name: "TrueNAS",       category: "STORAGE & CLOUD", statusMode: "off", icon: "",
    url: "", availability: "Public launch URL pending" },
  { id: "nextcloud", name: "Nextcloud",     category: "STORAGE & CLOUD", statusMode: "auto", icon: "",
    url: "https://cloud.zerotwosystems.com/" },
  { id: "porttracker", name: "Porttracker", category: "NETWORK & AUTOMATION", statusMode: "off", icon: "",
    url: "", availability: "Public launch URL pending" },
  { id: "homeassistant", name: "Home Assistant", category: "NETWORK & AUTOMATION", statusMode: "auto", icon: "",
    url: "https://home.zerotwosystems.com/" },
];

function isPrivateLanUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const m = host.match(/^172\.(\d{1,2})\./);
    return !!(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
  } catch (e) {
    return false;
  }
}

function sanitizeServiceUrl(svc) {
  if (!svc || !isPrivateLanUrl(svc.url || "")) return svc;
  if (svc.id === "jellyfin") return { ...svc, url: JELLYFIN_URL };
  if (svc.id === "seerr") return { ...svc, url: SEERR_URL };
  return { ...svc, url: "", statusMode: "off", availability: "Public launch URL pending" };
}

function migrate(list) {
  let out = Array.isArray(list) ? list.slice() : [];
  out = out.map(sanitizeServiceUrl);
  if (!out.some((s) => s.id === "seerr")) {
    const seerr = { id: "seerr", name: "Seerr", category: "MEDIA", statusMode: "auto", icon: "", url: SEERR_URL };
    const ji = out.findIndex((s) => s.id === "jellyfin");
    if (ji >= 0) out.splice(ji + 1, 0, seerr); else out.push(seerr);
  }
  return out;
}

const CAT_ORDER = ["MEDIA", "STORAGE & CLOUD", "NETWORK & AUTOMATION"];

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const d = JSON.parse(raw); if (Array.isArray(d) && d.length) return migrate(d); }
  } catch (e) {}
  return SEED;
}
function save(svcs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(svcs)); } catch (e) {}
}

const DEFAULT_API_BASE = "https://api.zerotwosystems.com";
const STATUS_REFRESH_MS = 30000;
const STATUS_TIMEOUT_MS = 8000;

function normalizeApiBase(base) {
  const trimmed = (base || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_API_BASE;
}

const API_BASE = (function () {
  try {
    const m = document.querySelector('meta[name="zerotwo-api-base"]');
    return normalizeApiBase(m && m.getAttribute("content"));
  } catch (e) { return DEFAULT_API_BASE; }
})();
const apiUrl = (path) => API_BASE + (path[0] === "/" ? path : "/" + path);

async function getJson(path, timeout = STATUS_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const response = await fetch(apiUrl(path), { cache: "no-store", signal: ctrl.signal });
    if (!response.ok) throw new Error("status api returned " + response.status);
    return await response.json();
  } finally {
    clearTimeout(t);
  }
}

function ping(url, timeout = 5000) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); }, timeout);
    fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal, redirect: "follow" })
      .then(() => { clearTimeout(t); resolve("online"); })
      .catch(() => { clearTimeout(t); resolve("offline"); });
  });
}

function normalizeStatus(status) {
  const st = String(status || "").trim().toLowerCase();
  if (st === "online" || st === "up") return "online";
  if (st === "degraded" || st === "warn" || st === "warning") return "degraded";
  if (st === "offline" || st === "down") return "offline";
  return "unknown";
}

function normalizeStatusService(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || entry.slug || entry.name || "").trim();
  if (!id) return null;
  const svc = { id, status: normalizeStatus(entry.status), lastChecked: entry.lastChecked || entry.updatedAt || entry.checkedAt || null };
  if (typeof entry.name === "string" && entry.name.trim()) svc.name = entry.name.trim();
  if (typeof entry.category === "string" && entry.category.trim()) svc.category = entry.category.trim().toUpperCase();
  if (typeof entry.url === "string" && entry.url.trim()) svc.url = entry.url.trim();
  if (typeof entry.icon === "string") svc.icon = entry.icon;
  if (typeof entry.statusMode === "string") svc.statusMode = entry.statusMode;
  return svc;
}

function statusListFromPayload(payload) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload && payload.services) ? payload.services : [];
  return raw.map(normalizeStatusService).filter(Boolean);
}

function mergeStatusServices(existing, backendServices) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const order = existing.map((s) => s.id);
  backendServices.forEach((svc) => {
    const prev = byId.get(svc.id);
    if (!prev) order.push(svc.id);
    byId.set(svc.id, { ...(prev || { name: svc.id, category: "OTHER", statusMode: "auto", icon: "", url: "#" }), ...svc });
  });
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function displayDateTime(value) {
  if (!value) return "never";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function greetWord(h) {
  if (h < 5) return "burning the midnight oil";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 21) return "good evening";
  return "good night";
}
function fmtClock(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtDate(d) {
  return d.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "2-digit" }).toUpperCase();
}

function App() {
  const [svcs, setSvcs] = useState(load);
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [statusMeta, setStatusMeta] = useState({ refreshing: false, backendUnavailable: false, updatedAt: null });
  const [q, setQ] = useState("");
  const [now, setNow] = useState(new Date());
  const [termOpen, setTermOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(() => { try { return sessionStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; } });
  const [auth, setAuth] = useState(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [pendingN, setPendingN] = useState(0);
  const operatorKeyRef = useRef("");
  const bootRef = useRef(new Date());
  const [newTab, setNewTab] = useState(() => {
    const v = localStorage.getItem(NEWTAB_KEY);
    return v === null ? true : v === "1";
  });
  const searchRef = useRef(null);
  const svcsRef = useRef(svcs);

  useEffect(() => { svcsRef.current = svcs; }, [svcs]);
  useEffect(() => save(svcs), [svcs]);
  useEffect(() => localStorage.setItem(NEWTAB_KEY, newTab ? "1" : "0"), [newTab]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const runChecks = useCallback(() => {
    let alive = true;
    setStatusMeta((prev) => ({ ...prev, refreshing: true }));
    getJson("/status", STATUS_TIMEOUT_MS)
      .then((payload) => {
        if (!alive) return;
        const backendServices = statusListFromPayload(payload);
        const nextStatuses = {};
        backendServices.forEach((svc) => { nextStatuses[svc.id] = svc.status; });
        setSvcs((prev) => mergeStatusServices(prev, backendServices));
        setStatuses(nextStatuses);
        setStatusMeta({
          refreshing: false,
          backendUnavailable: false,
          updatedAt: (payload && payload.updatedAt) || (payload && payload.lastChecked) || new Date().toISOString(),
        });
      })
      .catch(() => {
        if (!alive) return;
        setStatuses((prev) => {
          const next = { ...prev };
          svcsRef.current.forEach((s) => {
            if (s.statusMode === "auto" || !s.statusMode) next[s.id] = "unknown";
          });
          return next;
        });
        setStatusMeta((prev) => ({ ...prev, refreshing: false, backendUnavailable: true, updatedAt: new Date().toISOString() }));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => runChecks(), [runChecks]);
  useEffect(() => {
    const t = setInterval(runChecks, STATUS_REFRESH_MS);
    return () => clearInterval(t);
  }, [runChecks]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "`" && !e.ctrlKey && !e.metaKey) {
        const ae = document.activeElement;
        const inForm = ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.tagName === "TEXTAREA") && !ae.classList.contains("term-input");
        if (!inForm) {
          e.preventDefault();
          if (unlocked) setTermOpen((v) => !v);
          else setAuth({ reason: "the console", then: () => setTermOpen(true) });
        }
      } else if (e.key === "/" && document.activeElement !== searchRef.current && !termOpen) {
        e.preventDefault(); searchRef.current && searchRef.current.focus();
      } else if (e.key === "Escape") {
        if (modal) setModal(null);
        else if (termOpen) setTermOpen(false);
        else if (document.activeElement === searchRef.current) { setQ(""); searchRef.current.blur(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, termOpen, unlocked]);

  const categories = useMemo(() => {
    const set = [];
    svcs.forEach((s) => { const c = (s.category || "OTHER").toUpperCase(); if (!set.includes(c)) set.push(c); });
    set.sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib;
    });
    return set;
  }, [svcs]);

  const query = q.trim().toLowerCase();
  const isMatch = (s) =>
    !query ||
    s.name.toLowerCase().includes(query) ||
    (s.category || "").toLowerCase().includes(query) ||
    (s.url || "").toLowerCase().includes(query) ||
    (s.availability || "").toLowerCase().includes(query);
  const matches = useMemo(() => svcs.filter(isMatch), [svcs, query]);

  const onlineCount = svcs.filter((s) => {
    const st = s.statusMode === "up" ? "online" : s.statusMode === "down" ? "offline" : s.statusMode === "off" ? "off" : statuses[s.id];
    return st === "online";
  }).length;
  const tracked = svcs.filter((s) => s.statusMode !== "off").length;
  const effStatus = (s) => s.statusMode === "up" ? "online" : s.statusMode === "down" ? "offline" : s.statusMode === "off" ? "off" : (statuses[s.id] || "unknown");
  const launch = (url) => { if (url) window.open(url, newTab ? "_blank" : "_self"); };

  const requireAuth = (reason, then) => {
    if (unlocked) { if (then) then(); }
    else setAuth({ reason, then: then || (() => {}) });
  };
  const tryAuth = (pass) => {
    if (window.sha256hex(pass) === OPERATOR_KEY_SHA256) {
      setUnlocked(true);
      operatorKeyRef.current = pass;
      try { sessionStorage.setItem(UNLOCK_KEY, "1"); } catch (e) {}
      const then = auth && auth.then;
      setAuth(null);
      if (then) setTimeout(then, 0);
      return true;
    }
    return false;
  };
  const lock = () => {
    setUnlocked(false);
    operatorKeyRef.current = "";
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {}
    setTermOpen(false);
    setEditing(false);
    setInboxOpen(false);
  };

  useEffect(() => {
    if (!unlocked) { setPendingN(0); return; }
    let alive = true;
    window.requestApi.list(operatorKeyRef.current).then((res) => {
      if (!alive) return;
      const list = res.requests || [];
      setPendingN(list.filter((r) => r.status === "pending").length);
    });
    return () => { alive = false; };
  }, [unlocked, inboxOpen]);

  const upsert = (svc) => {
    setSvcs((prev) => {
      const exists = prev.some((s) => s.id === svc.id);
      if (exists) return prev.map((s) => (s.id === svc.id ? svc : s));
      return [...prev, { ...svc, id: svc.id || ("svc_" + Date.now().toString(36)) }];
    });
    setModal(null);
  };
  const del = (id) => { if (confirm("Delete this node?")) setSvcs((prev) => prev.filter((s) => s.id !== id)); };
  const setIcon = (id, icon) => setSvcs((prev) => prev.map((s) => (s.id === id ? { ...s, icon } : s)));
  const resetAll = () => { if (confirm("Reset dashboard to default services? Your custom tiles and logos will be lost.")) { setSvcs(SEED); save(SEED); } };

  const submitSearch = (e) => {
    e.preventDefault();
    if (!query) return;
    if (matches.length > 0) {
      if (matches[0].url) window.open(matches[0].url, newTab ? "_blank" : "_self");
    } else {
      window.open("https://www.google.com/search?q=" + encodeURIComponent(q), newTab ? "_blank" : "_self");
    }
  };

  const hour = now.getHours();

  return (
    <React.Fragment>
      <div className="topbar">
        <span className="brand">ZEROTWO<b>://</b>NEXUS</span>
        <span className="sep">│</span>
        <span className="stat t-date"><span className="v">{fmtDate(now)}</span></span>
        <span className="sep t-sep-clock">│</span>
        <span className="stat t-clock"><span className="v">{fmtClock(now)}</span></span>
        <span className="spacer"></span>
        <span className="stat t-nodes">● <span className="v">{onlineCount}/{tracked}</span> NODES ONLINE</span>
        <button className="btn req-cta" onClick={() => setReqOpen(true)}>request access</button>
        <span
          className={"lock" + (unlocked ? " open" : "")}
          onClick={() => (unlocked ? lock() : requireAuth("operator session", () => {}))}
          title={unlocked ? "operator authenticated  -  click to lock" : "locked  -  click to authenticate"}
        >
          <span className="ic">{unlocked ? "◍" : "○"}</span> {unlocked ? "operator" : "locked"}
        </span>
        {unlocked && (
          <button className="btn" onClick={() => setInboxOpen(true)}>
            inbox{pendingN > 0 ? <span className="pill-badge">{pendingN}</span> : null}
          </button>
        )}
        <button className={"btn" + (termOpen ? " on" : "")} onClick={() => requireAuth("the console", () => setTermOpen((v) => !v))}>terminal</button>
        <button className={"btn" + (editing ? " on" : "")} onClick={() => requireAuth("edit mode", () => setEditing((v) => !v))}>
          {editing ? "done" : "edit"}
        </button>
      </div>

      <div className="wrap">
        <header className="hero">
          <div className="eyebrow">root@zerotwo:~$ <span className="blink">./launch_nexus</span></div>
          <h1>ZeroTwo Systems</h1>
          <Typewriter items={TITLE_CYCLE} />
          <div className="greeting">
            <span className="prompt">&gt;</span> {greetWord(hour)}, <span className="hl">operator</span>
            {" "} -  {onlineCount} of {tracked} services responding. systems nominal.
          </div>
          <div className="status-line">
            {statusMeta.refreshing && <span className="refreshing">refreshing status…</span>}
            {statusMeta.backendUnavailable && <span className="status-warn">status backend unavailable</span>}
            <span>updated {displayDateTime(statusMeta.updatedAt)}</span>
          </div>

          <form className="search" onSubmit={submitSearch}>
            <span className="sigil">▮</span>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search services or the web…"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="hint">
              {query
                ? (matches.length ? <span>↵ open <b style={{ color: "var(--green)" }}>{matches[0].name}</b></span>
                                  : <span>↵ google “{q}”</span>)
                : <span><kbd>/</kbd> focus · <kbd>↵</kbd> launch</span>}
            </span>
          </form>
        </header>

        {!query && (
          <button className="howto-trigger" onClick={() => setHowOpen(true)}>
            <span className="ic">?</span>
            <span className="lbl">new here  -  how to request a movie or show</span>
            <span className="arr">→</span>
          </button>
        )}

        {categories.map((cat) => {
          const list = svcs.filter((s) => (s.category || "OTHER").toUpperCase() === cat);
          const visible = query ? list.filter(isMatch) : list;
          if (query && visible.length === 0) return null;
          return (
            <section className="cat" key={cat}>
              <div className="cat-head">
                <span className="tag"><span className="hash">//</span> {cat}</span>
                <span className="rule"></span>
                <span className="count">[ {list.length} ]</span>
              </div>
              <div className="grid">
                {list.map((s) => (
                  <ServiceTile
                    key={s.id}
                    svc={s}
                    status={statuses[s.id]}
                    lastChecked={s.lastChecked || statusMeta.updatedAt}
                    editing={editing}
                    dimmed={query ? !isMatch(s) : false}
                    matched={query ? isMatch(s) : false}
                    newTab={newTab}
                    unlocked={unlocked}
                    onEdit={(svc) => setModal({ svc })}
                    onDelete={del}
                    onIcon={setIcon}
                  />
                ))}
                {editing && !query && (
                  <div className="tile add" onClick={() => setModal({ svc: { ...{ name: "", url: "", icon: "", statusMode: "auto" }, category: cat } })}>+ add service</div>
                )}
              </div>
            </section>
          );
        })}

        {editing && !query && (
          <div style={{ marginTop: 28 }}>
            <button className="btn" onClick={() => setModal({ new: true })}>+ new node / category</button>
          </div>
        )}

        {!query && <DarlingBanner unlocked={unlocked} newTab={newTab} />}

        {query && matches.length === 0 && (
          <div className="no-match">
            no service matches “{q}”.&nbsp;
            <span className="g" onClick={() => window.open("https://www.google.com/search?q=" + encodeURIComponent(q), newTab ? "_blank" : "_self")}>
              search google ↵
            </span>
          </div>
        )}

        <footer className="foot">
          <span className="green">zerotwo.nexus</span>
          <span>v1.0</span>
          <span>{svcs.length} nodes · {categories.length} clusters</span>
          <span className="spacer" style={{ flex: 1 }}></span>
          <button className="btn" onClick={() => setNewTab((v) => !v)}>links: {newTab ? "new tab" : "same tab"}</button>
          <button className="btn" onClick={runChecks}>re-scan</button>
          <button className="btn danger" onClick={() => requireAuth("reset", resetAll)}>reset</button>
        </footer>
      </div>

      {modal && (
        <EditModal
          initial={modal.svc || null}
          categories={categories}
          onSave={upsert}
          onClose={() => setModal(null)}
          key={modal.svc && modal.svc.id ? modal.svc.id : "new"}
        />
      )}

      <Terminal
        open={termOpen}
        onClose={() => setTermOpen(false)}
        services={svcs}
        statusOf={effStatus}
        onLaunch={launch}
        onPing={runChecks}
        onAdd={() => setModal({ new: true })}
        onEdit={(s) => setModal({ svc: s })}
        onDelete={del}
        onLock={lock}
        onRequest={() => setReqOpen(true)}
        onInbox={() => setInboxOpen(true)}
        bootTime={bootRef.current}
      />

      <RequestPanel open={reqOpen} onClose={() => setReqOpen(false)} />

      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} newTab={newTab} seerrUrl={SEERR_URL} />

      <OperatorRequests
        open={inboxOpen}
        operatorKey={operatorKeyRef.current}
        onClose={() => setInboxOpen(false)}
        onCount={setPendingN}
      />

      {auth && (
        <AuthModal
          reason={auth.reason}
          onSubmit={tryAuth}
          onClose={() => setAuth(null)}
        />
      )}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
