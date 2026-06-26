/* ============================================================
   ZeroTwo Systems — UI components
   Exposes components on window for app.jsx
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;

/* ---- helpers ---- */
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "");
  } catch (e) {
    return url.replace(/^https?:\/\//, "");
  }
}
function monogram(name) {
  const parts = name.trim().split(/[\s\-_/]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
function readImageFile(file, cb) {
  if (!file || !file.type.startsWith("image/")) return;
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.readAsDataURL(file);
}

/* ============================================================
   // PERSONAL — zerotwolove.nl featured strip
   A warm plug for the side project. Drop (or click) a Zero Two
   pic onto the slot to set it — saved locally, operator only.
   To bake in a permanent image instead, drop a file in assets/
   and set DARLING_IMG below (e.g. "assets/zerotwo.jpg").
   ============================================================ */
const DARLING_IMG = "";                 // optional permanent image path
const DARLING_IMG_KEY = "zerotwo.darling.img.v1";

function DarlingBanner({ unlocked, newTab }) {
  const [img, setImg] = useState(() => { try { return localStorage.getItem(DARLING_IMG_KEY) || ""; } catch (e) { return ""; } });
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const src = img || DARLING_IMG;

  const setImage = (data) => {
    setImg(data);
    try { data ? localStorage.setItem(DARLING_IMG_KEY, data) : localStorage.removeItem(DARLING_IMG_KEY); } catch (e) {}
  };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDrag(false);
    if (!unlocked) return;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readImageFile(f, setImage);
  };
  const onShotClick = (e) => {
    if (!unlocked) return;            // visitors just follow the link
    e.preventDefault(); e.stopPropagation();
    fileRef.current && fileRef.current.click();
  };
  const pick = (e) => { const f = e.target.files && e.target.files[0]; if (f) readImageFile(f, setImage); };

  return (
    <section className="cat">
      <div className="cat-head">
        <span className="tag"><span className="hash">//</span> PERSONAL</span>
        <span className="rule"></span>
        <span className="count">[ 1 ]</span>
      </div>
      <a
        className="promo-banner"
        href="https://zerotwolove.nl"
        target={newTab ? "_blank" : "_self"}
        rel="noopener noreferrer"
      >
        <div
          className={"shot" + (unlocked ? " editable" : "") + (drag ? " dragover" : "")}
          onDragOver={(e) => { if (!unlocked) return; e.preventDefault(); e.stopPropagation(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={onShotClick}
          title={unlocked ? "drop or click to set a Zero Two pic" : "zerotwolove.nl"}
        >
          {src
            ? <img src={src} alt="Zero Two" />
            : <span className="shot-ph">drop<br />Zero&nbsp;Two<br />pic</span>}
          {unlocked && <span className="shot-dz">DROP PIC</span>}
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={pick} />
        </div>
        <div className="b-body">
          <div className="b-cmd"><span className="p">~/personal</span>$ cat .darling</div>
          <div className="b-title">zerotwolove.nl <span className="hb">♥</span></div>
          <div className="b-tag">A little corner of the web, made with love for my darling Zero Two.</div>
          <div className="b-cta">enter the archive →</div>
        </div>
      </a>
    </section>
  );
}

/* ============================================================
   Typewriter — cycles multilingual subtitle
   ============================================================ */
function Typewriter({ items, typeMs = 70, holdMs = 1700, delMs = 38 }) {
  const [idx, setIdx] = useState(0);
  const [txt, setTxt] = useState("");
  const [phase, setPhase] = useState("type"); // type | hold | del

  useEffect(() => {
    const cur = items[idx];
    let t;
    if (phase === "type") {
      if (txt.length < cur.length) t = setTimeout(() => setTxt(cur.slice(0, txt.length + 1)), typeMs);
      else { t = setTimeout(() => setPhase("hold"), holdMs); }
    } else if (phase === "hold") {
      t = setTimeout(() => setPhase("del"), 80);
    } else { // del
      if (txt.length > 0) t = setTimeout(() => setTxt(cur.slice(0, txt.length - 1)), delMs);
      else { setIdx((idx + 1) % items.length); setPhase("type"); }
    }
    return () => clearTimeout(t);
  }, [txt, phase, idx, items, typeMs, holdMs, delMs]);

  return (
    <span className="sub">
      <span className="accent">»</span> {txt}
      <span className="cursor"></span>
    </span>
  );
}

/* ============================================================
   Status dot
   ============================================================ */
function StatusDot({ state }) {
  const cls = state === "up" ? "up" : state === "down" ? "down" : state === "checking" ? "checking" : "off";
  return <span className={"dot " + cls} title={"status: " + (state || "off")}></span>;
}

/* ============================================================
   Service tile
   ============================================================ */
function ServiceTile({ svc, status, editing, dimmed, matched, newTab, unlocked, onEdit, onDelete, onIcon }) {
  const [drag, setDrag] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (!unlocked) return;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readImageFile(f, (data) => onIcon(svc.id, data));
  };

  const cls = ["tile"];
  if (drag) cls.push("dragover");
  if (dimmed) cls.push("dim");
  if (matched) cls.push("match");

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <a
      className={cls.join(" ")}
      href={svc.url}
      target={newTab ? "_blank" : "_self"}
      rel="noopener noreferrer"
      onDragOver={(e) => { if (!unlocked) return; e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      <StatusDot state={svc.statusMode === "off" ? "off" : svc.statusMode === "up" ? "up" : svc.statusMode === "down" ? "down" : status} />

      <div className={"icon" + (svc.icon ? " has-img" : "")}>
        {svc.icon ? <img src={svc.icon} alt="" /> : monogram(svc.name)}
        <span className="dz">DROP<br />LOGO</span>
      </div>

      <div className="meta">
        <div className="name">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{svc.name}</span>
          <span className="caret">›</span>
        </div>
        <div className="host">{hostOf(svc.url)}</div>
      </div>

      {editing && (
        <div className="edit-tools">
          <button onClick={(e) => { stop(e); onEdit(svc); }} title="Edit">✎</button>
          <button className="del" onClick={(e) => { stop(e); onDelete(svc.id); }} title="Delete">✕</button>
        </div>
      )}
    </a>
  );
}

/* ============================================================
   Edit / Add modal
   ============================================================ */
const BLANK = { name: "", url: "", category: "", icon: "", statusMode: "auto" };

function EditModal({ initial, categories, onSave, onClose }) {
  const isEdit = !!(initial && initial.id);
  const [f, setF] = useState(initial ? { ...BLANK, ...initial } : BLANK);
  const fileRef = useRef(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) readImageFile(file, (d) => set("icon", d));
  };
  const pasteUrl = () => {
    const u = prompt("Paste a logo image URL:");
    if (u) set("icon", u.trim());
  };

  const valid = f.name.trim() && f.url.trim();
  const save = () => {
    if (!valid) return;
    let url = f.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    onSave({ ...f, name: f.name.trim(), url, category: (f.category || "OTHER").trim().toUpperCase() });
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="m-head">
          <span>{isEdit ? "// edit_node" : "// new_node"}</span>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="m-body">
          <div className="icon-field">
            <div
              className={"preview" + (f.icon ? " has-img" : "")}
              onClick={() => fileRef.current && fileRef.current.click()}
              title="Click to upload a logo"
            >
              {f.icon ? <img src={f.icon} alt="" /> : (f.name ? monogram(f.name) : "··")}
            </div>
            <div className="ic-actions">
              <span>logo placeholder</span>
              <span className="lk" onClick={() => fileRef.current && fileRef.current.click()}>upload image</span>
              <span className="lk" onClick={pasteUrl}>paste url</span>
              {f.icon && <span className="lk" onClick={() => set("icon", "")}>clear</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={pickFile} />
          </div>

          <div className="field">
            <label>name</label>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Jellyfin" autoFocus />
          </div>
          <div className="field">
            <label>url</label>
            <input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://fin.zerotwosystems.com/" />
          </div>
          <div className="field">
            <label>category</label>
            <input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="MEDIA" list="cat-list" />
            <datalist id="cat-list">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="field">
            <label>status indicator</label>
            <div className="statuspick">
              {[["auto", "auto-ping"], ["up", "force up"], ["down", "force down"], ["off", "hide"]].map(([v, lbl]) => (
                <button key={v} className={f.statusMode === v ? "sel" : ""} onClick={() => set("statusMode", v)}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="m-foot">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn on" onClick={save} disabled={!valid} style={{ opacity: valid ? 1 : 0.4 }}>
            {isEdit ? "save" : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Auth gate modal
   ============================================================ */
function AuthModal({ reason, onSubmit, onClose }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);
  const ref = useRef(null);
  useEffect(() => { const t = setTimeout(() => ref.current && ref.current.focus(), 60); return () => clearTimeout(t); }, []);

  const submit = () => {
    if (!pass) return;
    const ok = onSubmit(pass);
    if (!ok) { setErr(true); setPass(""); ref.current && ref.current.focus(); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={"modal auth" + (err ? " shake" : "")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="m-head">
          <span>{"// authentication_required"}</span>
          <span className="x" onClick={onClose}>✕</span>
        </div>
        <div className="m-body">
          <div className="auth-note">
            <span className="l">root@zerotwo</span>:~$ operator key required
            {reason ? <span> to access <b>{reason}</b></span> : null}
          </div>
          <div className="field">
            <label>operator key</label>
            <input
              ref={ref}
              type="password"
              value={pass}
              onChange={(e) => { setPass(e.target.value); setErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="••••••••••"
              autoComplete="off"
            />
          </div>
          {err
            ? <div className="auth-err">✕ access denied · invalid operator key</div>
            : <div className="auth-hint">public access (links · search · status) needs no key.</div>}
        </div>
        <div className="m-foot">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn on" onClick={submit} style={{ opacity: pass ? 1 : 0.4 }}>authenticate</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   HowItWorks — plain-language "how requesting works" explainer.
   Fades in over the page. Written for people who aren't technical:
   request in Seerr -> it downloads itself -> it shows up in Jellyfin.
   A collapsed "under the hood" drawer keeps the pipeline detail out
   of the way for the curious.
   ============================================================ */
const HOW_STEPS = [
  {
    n: "01", k: "ask",
    title: "Ask for it",
    body: "Open the request portal and search for any movie or show — new releases, old favourites, a whole series. Found it? Press Request. That's the only thing you ever have to do.",
  },
  {
    n: "02", k: "fetch",
    title: "It fetches itself",
    body: "From here it's automatic. The system goes and finds a good-quality copy, downloads it, and files it away for you. No buttons, no waiting around — you can close the tab and forget about it.",
  },
  {
    n: "03", k: "watch",
    title: "Play it in Jellyfin",
    body: "When it's ready it simply appears in Jellyfin, as if it had always been there. Press play. Most things land within minutes; big or hard-to-find titles can take a few hours.",
  },
];

function HowItWorks({ open, onClose, newTab, seerrUrl }) {
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={"how-back" + (open ? " open" : "")}
      onMouseDown={onClose}
      aria-hidden={!open}
    >
      <div className="how" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="how requesting works">
        <div className="how-head">
          <div className="ht">
            <span className="kw">// guide</span>
            <h2>How requesting works</h2>
            <p>The no-jargon version — for anyone who just wants to watch something.</p>
          </div>
          <span className="x" onClick={onClose} title="close">✕</span>
        </div>

        <div className="how-body">
          <p className="how-intro">
            Want to watch something that isn't in the library yet? You don't have to message
            anyone. Just <b>request it</b> — here's the whole journey, start to finish.
          </p>

          <div className="how-steps">
            {HOW_STEPS.map((s, i) => (
              <div className={"how-step k-" + s.k} key={s.n}>
                <div className="rail">
                  <span className="num">{s.n}</span>
                  {i < HOW_STEPS.length - 1 && <span className="conn"></span>}
                </div>
                <div className="step-body">
                  <div className="step-title">{s.title}</div>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="how-know">
            <span className="kh">good to know</span>
            <ul>
              <li>One request covers the whole thing — ask for a series and you get every season and episode.</li>
              <li>You always watch in <b>Jellyfin</b>. The request portal is just your wishlist — it doesn't play anything itself.</li>
              <li>If someone already requested it, it'll simply show as available — no harm in asking twice.</li>
            </ul>
          </div>

          <div className="how-under">
            <button className={"hu-toggle" + (more ? " on" : "")} onClick={() => setMore((v) => !v)}>
              <span className="chev">{more ? "▾" : "▸"}</span> under the hood — for the curious
            </button>
            {more && (
              <div className="hu-body">
                <p>
                  Seerr hands your request to <b>Radarr</b> (films) or <b>Sonarr</b> (TV). They search
                  <b> nzbgeek</b> for a release, then <b>NZBGet</b> pulls it down over <b>Newshosting</b> —
                  or <b>qBittorrent</b> grabs a torrent — and drops the file into the library Jellyfin reads from.
                </p>
                <div className="hu-chain">
                  <span>Seerr</span><i>→</i><span>Radarr / Sonarr</span><i>→</i><span>nzbgeek</span><i>→</i><span>NZBGet · Newshosting</span><i>→</i><span className="end">Jellyfin</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="how-foot">
          <a
            className="btn on how-cta"
            href={seerrUrl}
            target={newTab ? "_blank" : "_self"}
            rel="noopener noreferrer"
          >
            open the request portal →
          </a>
          <button className="btn" onClick={onClose}>got it</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Typewriter, StatusDot, ServiceTile, EditModal, AuthModal, DarlingBanner, HowItWorks, hostOf, monogram });
