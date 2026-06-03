/* ============================================================
   ZeroTwo Systems — interactive console
   Quake-style drop-down terminal that drives the dashboard.
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;

const TERM_CMDS = [
  "help", "ls", "services", "open", "go", "launch", "status", "ping",
  "search", "google", "add", "edit", "rm", "del", "delete", "clear",
  "cls", "date", "whoami", "echo", "neofetch", "about", "history",
  "requests", "request", "passwd", "lock", "sudo", "exit", "close",
];
const ARG_CMDS = ["open", "go", "launch", "edit", "rm", "del", "delete", "status", "cat"];

function tpad(s, n) {
  s = String(s);
  if (s.length > n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}
function hms(ms) {
  const t = Math.floor(ms / 1000);
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const s = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function Terminal({ open, onClose, services, statusOf, onLaunch, onPing, onAdd, onEdit, onDelete, onLock, onRequest, onInbox, bootTime }) {
  const idRef = useRef(0);
  const histRef = useRef([]);
  const ptrRef = useRef(0);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState(() => [
    { id: -2, node: <div className="term-line l-sys">ZeroTwo Nexus shell · v1.0</div> },
    { id: -1, node: <div className="term-line l-dim">type <span className="l-ok">help</span> for a list of commands · <span className="l-ok">neofetch</span> for system info</div> },
  ]);

  const push = useCallback((node) => setLines((p) => [...p, { id: idRef.current++, node }]), []);
  const line = useCallback((content, cls) => push(<div className={"term-line " + (cls || "")}>{content}</div>), [push]);

  /* autoscroll + focus */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);
  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current && inputRef.current.focus(), 60);
  }, [open]);

  /* ---- service matching ---- */
  const findSvc = (arg) => {
    if (!arg) return null;
    if (/^\d+$/.test(arg)) return services[parseInt(arg, 10) - 1] || null;
    const a = arg.toLowerCase();
    return services.find((s) => s.name.toLowerCase() === a) ||
           services.find((s) => s.name.toLowerCase().includes(a)) || null;
  };
  const stCls = (st) => "l-" + (st === "up" ? "up" : st === "down" ? "down" : st === "checking" ? "amber" : "off");
  const stTxt = (st) => st === "up" ? "● UP" : st === "down" ? "○ DOWN" : st === "checking" ? "◌ ····" : "· off";

  /* ---- commands ---- */
  const neofetch = () => {
    const up = services.filter((s) => statusOf(s) === "up").length;
    const tracked = services.filter((s) => s.statusMode !== "off").length;
    const cats = new Set(services.map((s) => (s.category || "OTHER").toUpperCase())).size;
    const logo = ["╔═╗ ╔═╗", "║ ║ ╔═╝", "║ ║ ║  ", "║ ║ ╚═╗", "╚═╝ ╚═╝"];
    const info = [
      ["operator", "@zerotwosystems"],
      ["", "───────────────────"],
      ["os......: ", "ZeroTwo Nexus v1.0"],
      ["host....: ", "zerotwosystems.com"],
      ["nodes...: ", `${services.length} across ${cats} clusters`],
      ["online..: ", `${up} up / ${tracked} tracked`],
      ["uptime..: ", hms(Date.now() - bootTime.getTime())],
      ["shell...: ", "nexus-sh 1.0"],
    ];
    const rows = Math.max(logo.length, info.length);
    for (let i = 0; i < rows; i++) {
      const l = logo[i] || "       ";
      const inf = info[i] || ["", ""];
      push(
        <div className="term-line">
          <span className="l-sys">{tpad(l, 9)}</span>
          <span className="l-ok">{inf[0]}</span>
          <span className="l-cmd">{inf[1]}</span>
        </div>
      );
    }
  };

  const listServices = () => {
    line(<span>{tpad("#", 3)}{tpad("NAME", 18)}{tpad("CLUSTER", 22)}{tpad("HOST", 30)}STATUS</span>, "l-dim");
    services.forEach((s, i) => {
      const st = statusOf(s);
      push(
        <div className="term-line">
          <span className="l-dim">{tpad(i + 1, 3)}</span>
          <span className="l-ok">{tpad(s.name, 18)}</span>
          <span className="l-dim">{tpad((s.category || "OTHER").toUpperCase(), 22)}</span>
          <span className="l-cmd">{tpad(window.hostOf(s.url), 30)}</span>
          <span className={stCls(st)}>{stTxt(st)}</span>
        </div>
      );
    });
    line(<span>{services.length} nodes. <span className="l-ok">open &lt;#|name&gt;</span> to launch.</span>, "l-dim");
  };

  const run = (raw) => {
    const cmdline = raw.trim();
    push(<div className="term-line l-cmd"><span className="p">operator@zerotwo</span>:~$ {cmdline}</div>);
    if (!cmdline) return;
    histRef.current.push(cmdline);
    ptrRef.current = histRef.current.length;

    const parts = cmdline.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = cmdline.slice(parts[0].length).trim();

    switch (cmd) {
      case "help":
        line("available commands", "l-sys");
        [
          ["ls / services", "list all services + live status"],
          ["open <#|name>", "launch a service (also: go, launch)"],
          ["status [name]", "re-scan and show node status"],
          ["search <query>", "search the web via Google"],
          ["add", "open the new-service dialog"],
          ["edit <name>", "edit a service"],
          ["rm <name>", "delete a service"],
          ["neofetch", "system summary"],
          ["requests", "open the operator request inbox"],
          ["passwd <phrase>", "generate a new operator-key hash"],
          ["lock", "end operator session"],
          ["whoami / date", "session info"],
          ["history", "command history"],
          ["clear", "clear the console"],
          ["exit", "close the console (or press ` )"],
        ].forEach(([c, d]) => line(<span><span className="l-ok">{tpad(c, 18)}</span><span className="l-dim">{d}</span></span>));
        break;

      case "ls":
      case "services":
        listServices();
        break;

      case "open":
      case "go":
      case "launch": {
        if (!arg) { line("usage: open <#|name>", "l-err"); break; }
        const s = findSvc(arg);
        if (!s) { line(`no service matching "${arg}". try \`ls\`.`, "l-err"); break; }
        line(<span>launching <span className="l-ok">{s.name}</span> → <span className="l-dim">{s.url}</span></span>, "l-sys");
        onLaunch(s.url);
        break;
      }

      case "status":
      case "ping": {
        if (arg) {
          const s = findSvc(arg);
          if (!s) { line(`no service matching "${arg}".`, "l-err"); break; }
          const st = statusOf(s);
          line(<span><span className="l-ok">{s.name}</span>  <span className={stCls(st)}>{stTxt(st)}</span>  <span className="l-dim">{window.hostOf(s.url)}</span></span>);
        } else {
          line("re-scanning all nodes…", "l-sys");
          onPing();
          setTimeout(() => listServices(), 400);
        }
        break;
      }

      case "search":
      case "google": {
        if (!arg) { line("usage: search <query>", "l-err"); break; }
        line(<span>searching google for "<span className="l-ok">{arg}</span>"…</span>, "l-sys");
        onLaunch("https://www.google.com/search?q=" + encodeURIComponent(arg));
        break;
      }

      case "add":
        line("opening new-service dialog…", "l-sys");
        onAdd();
        break;

      case "edit": {
        const s = findSvc(arg);
        if (!s) { line(`no service matching "${arg}".`, "l-err"); break; }
        line(<span>editing <span className="l-ok">{s.name}</span>…</span>, "l-sys");
        onEdit(s);
        break;
      }

      case "rm":
      case "del":
      case "delete": {
        const s = findSvc(arg);
        if (!s) { line(`no service matching "${arg}".`, "l-err"); break; }
        onDelete(s.id);
        line(<span>requested deletion of <span className="l-ok">{s.name}</span>.</span>, "l-dim");
        break;
      }

      case "echo":
        line(arg || "", "l-cmd");
        break;

      case "date":
        line(new Date().toString(), "l-cmd");
        break;

      case "whoami":
        line("operator", "l-ok");
        line(<span className="l-dim">root access to {services.length} nodes on the zerotwo nexus.</span>);
        break;

      case "neofetch":
        neofetch();
        break;

      case "about":
        line("ZeroTwo Systems — HomeLab Nexus", "l-sys");
        line(<span className="l-dim">a single-file start page served from your nginx root. green-on-black, because of course.</span>);
        break;

      case "history":
        if (!histRef.current.length) { line("no history yet.", "l-dim"); break; }
        histRef.current.forEach((h, i) => line(<span><span className="l-dim">{tpad(i + 1, 4)}</span>{h}</span>));
        break;

      case "sudo":
        line("operator is already root. nice try.", "l-amber");
        break;

      case "passwd": {
        if (!arg) { line("usage: passwd <new passphrase>", "l-err"); break; }
        const h = window.sha256hex(arg);
        line("new operator-key hash generated:", "l-sys");
        line(h, "l-ok");
        line("paste it into assets/app.jsx, replacing the value of", "l-dim");
        line("OPERATOR_KEY_SHA256, then re-deploy. plaintext is never stored.", "l-dim");
        break;
      }

      case "lock":
        line("ending operator session…", "l-sys");
        if (onLock) setTimeout(onLock, 250);
        break;

      case "requests":
      case "inbox":
        line("opening request inbox…", "l-sys");
        if (onInbox) onInbox();
        break;

      case "request":
        line("opening account-request form…", "l-sys");
        if (onRequest) onRequest();
        break;

      case "clear":
      case "cls":
        setLines([]);
        break;

      case "exit":
      case "close":
        onClose();
        break;

      default:
        line(<span>command not found: <span className="l-err">{cmd}</span>. type <span className="l-ok">help</span>.</span>, "l-err");
    }
  };

  /* ---- input handling ---- */
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      run(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!histRef.current.length) return;
      ptrRef.current = Math.max(0, ptrRef.current - 1);
      setInput(histRef.current[ptrRef.current] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      ptrRef.current = Math.min(histRef.current.length, ptrRef.current + 1);
      setInput(histRef.current[ptrRef.current] || "");
    } else if (e.key === "Tab") {
      e.preventDefault();
      const parts = input.split(/\s+/);
      if (parts.length <= 1) {
        const m = TERM_CMDS.filter((c) => c.startsWith(parts[0].toLowerCase()));
        if (m.length === 1) setInput(m[0] + " ");
        else if (m.length > 1) line(m.join("   "), "l-dim");
      } else if (ARG_CMDS.includes(parts[0].toLowerCase())) {
        const partial = parts.slice(1).join(" ").toLowerCase();
        const m = services.filter((s) => s.name.toLowerCase().startsWith(partial));
        if (m.length === 1) setInput(parts[0] + " " + m[0].name);
        else if (m.length > 1) line(m.map((s) => s.name).join("   "), "l-dim");
      }
    }
  };

  return (
    <div className={"term" + (open ? " open" : "")} aria-hidden={!open}>
      <div className="term-bar">
        <span className="tdots"><i></i><i></i><i></i></span>
        <span className="ttitle">NEXUS-SH</span>
        <span className="tpath">operator@zerotwo: ~</span>
        <span className="spacer"></span>
        <span className="thint"><kbd>tab</kbd> complete · <kbd>↑</kbd> history · <kbd>`</kbd> toggle</span>
        <span className="tclose" onClick={onClose}>✕</span>
      </div>
      <div className="term-body" ref={bodyRef} onClick={() => inputRef.current && inputRef.current.focus()}>
        {lines.map((l) => <React.Fragment key={l.id}>{l.node}</React.Fragment>)}
      </div>
      <div className="term-input-row">
        <span className="p">operator@zerotwo:~$</span>
        <input
          ref={inputRef}
          className="term-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          placeholder="type a command…"
        />
      </div>
    </div>
  );
}

Object.assign(window, { Terminal });
