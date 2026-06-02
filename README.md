# ZeroTwo Systems — HomeLab Nexus

A self-hosted **start page / service dashboard** with a CRT-phosphor terminal
aesthetic (green-on-black, JetBrains Mono, scanlines). One central spot that
links out to all your services, with live status, an in-page editor, an
interactive console, an operator lock, and a public account-request system.

> Implemented from a Claude Design handoff bundle as a **single self-contained
> HTML file** — no build step, no CDN JavaScript, no in-browser transpilation.
> React (production build), the compiled UI, and the CSS are all inlined. Drop
> the one file into your web root and you're done.

## Files

```
ZeroTwo Dashboard.html   ← the dashboard. This is the whole frontend. Deploy this.
backend/                 ← optional zero-dependency Node service for the request system
  server.js              ← enforces the REAL per-IP once-per-day limit + bot traps (+ CORS)
  nginx.conf.example     ← edge rate-limiting + reverse proxy (same-origin hosting)
  nginx.truenas.conf     ← ready-to-mount nginx for the split SiteGround+TrueNAS setup
  README.md              ← backend deploy steps (systemd unit included)
build/                   ← optional: source + tooling to regenerate the HTML (ignore for normal use)
DEPLOY-siteground-truenas.md  ← split hosting: page on SiteGround, backend on TrueNAS
README.md                ← this file
```

## Quick start (frontend only)

```sh
# copy the dashboard into your nginx web root and (optionally) make it the index
cp "ZeroTwo Dashboard.html" /var/www/zerotwo/index.html
```

```nginx
server {
    listen 443 ssl http2;
    server_name zerotwosystems.com;
    root  /var/www/zerotwo;
    index index.html;            # the renamed ZeroTwo Dashboard.html
    location / { try_files $uri $uri/ =404; }
}
```

That alone gives you the full dashboard. The request panel runs in a clearly
labelled **demo mode** (localStorage) until you deploy the backend below.

## Features

- **Cycling multilingual title** — `ZeroTwo Systems` with the subtitle
  typewriter-cycling `HomeLab Nexus → होमलैब नेक्सस → ホームラボ・ネクサス → 家庭实验室枢纽`.
- **Live clock, time-aware greeting, and an `N/8 NODES ONLINE` counter.**
- **Service tiles** grouped into MEDIA / STORAGE & CLOUD / NETWORK & AUTOMATION,
  each with a status dot and a drop-in logo placeholder (drag an image onto it).
- **Search** — press `/` to focus; Enter opens the top matching service or falls
  back to a Google search.
- **NEXUS-SH console** — press `` ` `` (backtick) or the **TERMINAL** button.
  Commands: `ls`, `open <#|name>`, `status`, `search`, `add`/`edit`/`rm`,
  `neofetch`, `passwd`, `lock`, `requests`, `help`, plus tab-completion and
  `↑/↓` history.
- **In-page editor** — **EDIT** mode adds/edits/deletes tiles; everything
  persists to your browser's localStorage.
- **Operator lock** — the console, editing, logo drops, reset, and the request
  inbox are gated behind an operator passphrase (SHA-256 hashed, never stored in
  plaintext). Links, search, and status stay public.
- **Account requests** — a public slide-over where visitors request an account
  on a service (Jellyfin/Plex/Immich/Navidrome/Nextcloud), one per day, with an
  operator-only inbox to approve/deny/delete.

## Operator passphrase

The default passphrase is **`zerotwo`** — change it.

1. Open the console (it will prompt to unlock), run `passwd your new phrase`.
2. Paste the printed hash over `OPERATOR_KEY_SHA256` in `build/src/app.jsx`,
   then `cd build && npm run build` to regenerate the HTML.
3. Set the **same** hash as the backend's `OPERATOR_KEY_SHA256` env var so the
   inbox authenticates. Only the hash is ever stored.

## The account-request system (real enforcement)

A static page **cannot** truly rate-limit by IP or stop a bot — client-side
cookies/localStorage are per-browser and a bot ignores your JS entirely. The
"one request per day, can't be botted, can't crash the site" guarantee lives in
`backend/` + nginx:

- **`backend/server.js`** — one request per IP per rolling 24h, honeypot +
  minimum-form-time bot traps, 4 KB body cap, max-pending/total caps so the disk
  can't be filled, atomic writes. Operator endpoints are authed by the same
  SHA-256 key.
- **`backend/nginx.conf.example`** — `limit_req` zones that absorb a flood at the
  edge before it ever reaches Node.

Deploy steps are in [`backend/README.md`](backend/README.md). Once the backend is
live the dashboard auto-detects it and switches from demo mode to real data.

### Same-origin vs split hosting

- **Same origin** (page + backend on one server): no config needed — the page
  calls a relative `/api/...` and `backend/nginx.conf.example` proxies it.
- **Split hosting** (page on one host, backend on another — e.g. **page on
  SiteGround, backend on TrueNAS**): set `<meta name="zerotwo-api-base">` in the
  page `<head>` to the backend's public URL, and set the backend's `CORS_ORIGIN`
  env to the page's origin. Full walkthrough (TrueNAS SCALE Custom App +
  Cloudflare Tunnel + DNS) in
  [`DEPLOY-siteground-truenas.md`](DEPLOY-siteground-truenas.md), with a
  ready-to-mount [`backend/nginx.truenas.conf`](backend/nginx.truenas.conf).

## Things worth knowing (carried over from the design)

- **The in-page lock is a deterrent, not real security.** Because the page is
  served statically, a technical visitor can read the source or bypass the JS
  gate. It reliably stops *casual* visitors from poking the console or editing
  your board. For hard enforcement, put the page (or just `/api/`) behind nginx
  auth — see the commented `auth_basic` block in `nginx.conf.example`. Your
  actual services stay protected by their own logins / your VPN regardless.
- **Status dots are browser-side.** A tile shows "up" only if *your* browser can
  reach it, so LAN-IP services (TrueNAS, Jellyfin, …) read as down unless you're
  on the VPN/LAN. Serving the page over HTTPS also blocks pinging `http://` LAN
  services (mixed content). Use a tile's **force up / hide** status override in
  the editor for anything you don't want auto-pinged.
- **Dropped logos are stored per-browser** (localStorage), not in the file —
  clearing site data resets them. To make logos permanent/shared, bake the
  images into the page and set each service's `icon`.
- **Fonts** load from Google Fonts. To run fully offline, self-host the
  JetBrains Mono / Noto families and swap the `<link>` in the HTML `<head>`.
