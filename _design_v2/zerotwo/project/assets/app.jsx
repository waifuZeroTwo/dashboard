/* ============================================================
   ZeroTwo Systems — app
   ============================================================ */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const STORE_KEY = "zerotwo.nexus.v1";
const NEWTAB_KEY = "zerotwo.newtab.v1";
const UNLOCK_KEY = "zerotwo.unlocked.v1";

/* --- operator key ---------------------------------------------------------
   SHA-256 of the operator passphrase. Default passphrase is "zerotwo".
   CHANGE IT: open the console (unlocked), run  passwd <new phrase>  and paste
   the printed hash here. The plaintext is never stored in this file.
   NOTE: a static page can only DETER tampering. For real enforcement put the
   page behind nginx auth (basic_auth / auth_request). See notes from the chat. */
const OPERATOR_KEY_SHA256 = "61d8dc87458a24eae39d74abb171656a42efcb999fdc38633770c1734b9295ea";

const TITLE_CYCLE = [
  "HomeLab Nexus",
  "होमलैब नेक्सस",
  "ホームラボ・ネクサス",
  "家庭实验室枢纽",
];

/* ---- seed services (from operator config) ---- */
const SEED = [
  { id: "plex",      name: "Plex",          category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://app.plex.tv/desktop/#!/media/57516c32494cc91916f81ad71efb32e1bbd73677/com.plexapp.plugins.library?source=1" },
  { id: "jellyfin",  name: "Jellyfin",      category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://fin.zerotwosystems.com/" },
  { id: "navidrome", name: "Navidrome",     category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://music.zerotwosystems.com/" },
  { id: "immich",    name: "Immich",        category: "MEDIA",  statusMode: "auto", icon: "",
    url: "https://photos.zerotwosystems.com/" },
  { id: "truenas",   name: "TrueNAS",       category: "STORAGE & CLOUD", statusMode: "auto", icon: "",
    url: "http://192.168.1.83:81/ui/dashboard" },
  { id: "nextcloud", name: "Nextcloud",     category: "STORAGE & CLOUD", statusMode: "auto", icon: "",
    url: "https://cloud.zerotwosystems.com/" },
  { id: "porttracker", name: "Porttracker", category: "NETWORK & AUTOMATION", statusMode: "auto", icon: "",
    url: "http://192.168.1.83:30233/?server=local" },
  { id: "homeassistant", name: "Home Assistant", category: "NETWORK & AUTOMATION", statusMode: "auto", icon: "",
    url: "https://home.zerotwosystems.com/" },
];

const CAT_ORDER = ["MEDIA", "STORAGE & CLOUD", "NETWORK & AUTOMATION"];

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const d = JSON.parse(raw); if (Array.isArray(d) && d.length) return d; }
  } catch (e) {}
  return SEED;
}
function save(svcs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(svcs)); } catch (e) {}
}

/* ---- status ping (best-effort, browser no-cors) ---- */
function ping(url, timeout = 5000) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); }, timeout);
    fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal, redirect: "follow" })
      .then(() => { clearTimeout(t); resolve("up"); })
      .catch(() => { clearTimeout(t); resolve("down"); });
  });
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

/* ============================================================ */
function App() {
  const [svcs, setSvcs] = useState(load);
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null); // {svc} | {new:true} | null
  const [statuses, setStatuses] = useState({}); // id -> up|down|checking
  const [q, setQ] = useState("");
  const [now, setNow] = useState(new Date());
  const [termOpen, setTermOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(() => { try { return sessionStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; } });
  const [auth, setAuth] = useState(null); // { reason, then }
  const [reqOpen, setReqOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [pendingN, setPendingN] = useState(0);
  const operatorKeyRef = useRef("");
  const bootRef = useRef(new Date());
  const [newTab, setNewTab] = useState(() => {
    const v = localStorage.getItem(NEWTAB_KEY);
    return v === null ? true : v === "1";
  });
  const searchRef = useRef(null);

  useEffect(() => save(svcs), [svcs]);
  useEffect(() => localStorage.setItem(NEWTAB_KEY, newTab ? "1" : "0"), [newTab]);

  /* clock */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* status checks */
  const runChecks = useCallback(() => {
    const targets = svcs.filter((s) => s.statusMode === "auto" || !s.statusMode);
    if (!targets.length) return;
    setStatuses((prev) => {
      const n = { ...prev };
      targets.forEach((s) => { n[s.id] = "checking"; });
      return n;
    });
    targets.forEach((s) => {
      ping(s.url).then((res) => setStatuses((prev) => ({ ...prev, [s.id]: res })));
    });
  }, [svcs]);

  useEffect(() => { runChecks(); /* eslint-disable-next-line */ }, [svcs.length]);
  useEffect(() => {
    const t = setInterval(runChecks, 60000);
    return () => clearInterval(t);
  }, [runChecks]);

  /* keyboard: "/" focus search, esc clears, ` toggles terminal */
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

  /* ---- derived ---- */
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
    s.url.toLowerCase().includes(query);
  const matches = useMemo(() => svcs.filter(isMatch), [svcs, query]);

  const onlineCount = svcs.filter((s) => {
    const st = s.statusMode === "up" ? "up" : s.statusMode === "down" ? "down" : s.statusMode === "off" ? "off" : statuses[s.id];
    return st === "up";
  }).length;
  const tracked = svcs.filter((s) => s.statusMode !== "off").length;
  const effStatus = (s) => s.statusMode === "up" ? "up" : s.statusMode === "down" ? "down" : s.statusMode === "off" ? "off" : (statuses[s.id] || "checking");
  const launch = (url) => window.open(url, newTab ? "_blank" : "_self");

  /* ---- access control (client-side deterrent) ---- */
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

  /* pending-request count for the operator badge */
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

  /* ---- actions ---- */
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
      window.open(matches[0].url, newTab ? "_blank" : "_self");
    } else {
      window.open("https://www.google.com/search?q=" + encodeURIComponent(q), newTab ? "_blank" : "_self");
    }
  };

  const hour = now.getHours();

  return (
    <React.Fragment>
      {/* top strip */}
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
          title={unlocked ? "operator authenticated — click to lock" : "locked — click to authenticate"}
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
        {/* hero */}
        <header className="hero">
          <div className="eyebrow">root@zerotwo:~$ <span className="blink">./launch_nexus</span></div>
          <h1>ZeroTwo Systems</h1>
          <Typewriter items={TITLE_CYCLE} />
          <div className="greeting">
            <span className="prompt">&gt;</span> {greetWord(hour)}, <span className="hl">operator</span>
            {" "}— {onlineCount} of {tracked} services responding. systems nominal.
          </div>

          {/* search */}
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

        {/* categories */}
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

        {/* global add when editing (new category) */}
        {editing && !query && (
          <div style={{ marginTop: 28 }}>
            <button className="btn" onClick={() => setModal({ new: true })}>+ new node / category</button>
          </div>
        )}

        {/* no matches */}
        {query && matches.length === 0 && (
          <div className="no-match">
            no service matches “{q}”.&nbsp;
            <span className="g" onClick={() => window.open("https://www.google.com/search?q=" + encodeURIComponent(q), newTab ? "_blank" : "_self")}>
              search google ↵
            </span>
          </div>
        )}

        {/* footer */}
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

      {/* modal */}
      {modal && (
        <EditModal
          initial={modal.svc || null}
          categories={categories}
          onSave={upsert}
          onClose={() => setModal(null)}
          key={modal.svc && modal.svc.id ? modal.svc.id : "new"}
        />
      )}

      {/* console */}
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

      {/* request panel (public) */}
      <RequestPanel open={reqOpen} onClose={() => setReqOpen(false)} />

      {/* operator inbox (gated) */}
      <OperatorRequests
        open={inboxOpen}
        operatorKey={operatorKeyRef.current}
        onClose={() => setInboxOpen(false)}
        onCount={setPendingN}
      />

      {/* auth gate */}
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
