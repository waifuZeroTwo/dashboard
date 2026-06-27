
const { useState, useEffect, useRef, useCallback } = React;

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

function StatusDot({ state }) {
  const cls = state === "up" ? "up" : state === "down" ? "down" : state === "checking" ? "checking" : "off";
  return <span className={"dot " + cls} title={"status: " + (state || "off")}></span>;
}

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

Object.assign(window, { Typewriter, StatusDot, ServiceTile, EditModal, AuthModal, hostOf, monogram });
