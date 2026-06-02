# Deploy: page on SiteGround, backend on TrueNAS

Your setup is a **split deployment**:

- the **static dashboard** is hosted by **SiteGround** at your public domain;
- the **request backend** (the per-IP/day + anti-bot enforcement) runs at home on
  **TrueNAS SCALE**, reached through a public `api.` subdomain.

```
                 ┌─────────────────────────────────────────────┐
  visitor ──────▶│ SiteGround   https://zerotwosystems.nl       │  (static index.html)
  browser        └─────────────────────────────────────────────┘
      │   page JS calls the API (cross-origin, HTTPS)
      ▼
  https://api.zerotwosystems.nl
      │   public exposure: Cloudflare Tunnel (recommended) — no open ports, free TLS
      ▼
  ┌──────────────── TrueNAS SCALE 24.10+ (192.168.1.83) ───────────────┐
  │  cloudflared  →  nginx (limit_req)  →  node server.js               │
  │                                        per-IP/day · honeypot · caps │
  └────────────────────────────────────────────────────────────────────┘
```

Because the page and the API are on **different origins**, the dashboard already
ships with two things wired up for you:

- the page reads `<meta name="zerotwo-api-base">` and calls that absolute URL;
- the backend emits **CORS** headers for the origins you list in `CORS_ORIGIN`
  and prefers `CF-Connecting-IP` for the per-IP limit.

> Heads-up on domains: your services use `*.zerotwosystems.com`, but you said the
> site domain bought at SiteGround is `zerotwosystems.nl`. Use **whichever domain
> actually serves the page** consistently in the two places marked below
> (the `<meta>` tag and `CORS_ORIGIN`). Examples use `.nl`.

---

## Part A — SiteGround (the page)

1. **Upload** `index.html` to your site root (`public_html`) via Site
   Tools → File Manager (or SFTP).
2. **Point it at your backend.** Edit the `<head>` and set the api-base meta tag
   to the public API URL you'll create in Part C/D:
   ```html
   <meta name="zerotwo-api-base" content="https://api.zerotwosystems.nl" />
   ```
   (It ships empty. Empty = same-origin; you must set it for the split setup.)
3. SiteGround already serves the page over HTTPS. Load it — everything except the
   request panel works immediately. The request panel will go live once Parts B–D
   are done; until then it shows demo mode.

> SiteGround shared hosting can't reverse-proxy to your house, which is exactly
> why we use a separate `api.` subdomain + CORS instead of a same-origin `/api`.

---

## Part B — TrueNAS: run the backend

Pick a dataset to hold the app, e.g. `/mnt/<POOL>/apps/zerotwo`. Replace `<POOL>`
with your pool name everywhere below.

1. **Put the files on TrueNAS** (SMB, `scp`, or the Shell):
   ```
   /mnt/<POOL>/apps/zerotwo/server.js            ← from this repo's backend/server.js
   /mnt/<POOL>/apps/zerotwo/nginx.truenas.conf   ← from this repo's backend/nginx.truenas.conf
   /mnt/<POOL>/apps/zerotwo/data/                 ← empty dir; persists requests.json
   ```
2. **Generate your operator key hash** (must match the dashboard's). In the
   dashboard console run `passwd your phrase`, or on any machine:
   ```sh
   printf '%s' 'your operator passphrase' | shasum -a 256
   ```
3. **Create the app:** TrueNAS UI → **Apps → Discover Apps → Custom App →
   "Install via YAML"**, and paste this, editing the three `# <-- EDIT` lines:
   ```yaml
   services:
     zerotwo-api:
       image: node:22-alpine
       restart: unless-stopped
       command: ["node", "/app/server.js"]
       environment:
         HOST: "0.0.0.0"
         PORT: "8787"
         DATA_DIR: "/data"
         OPERATOR_KEY_SHA256: "PASTE_YOUR_HASH_HERE"      # <-- EDIT (same as dashboard)
         CORS_ORIGIN: "https://zerotwosystems.nl"         # <-- EDIT (the page's exact origin)
       volumes:
         - /mnt/<POOL>/apps/zerotwo/server.js:/app/server.js:ro   # <-- EDIT pool
         - /mnt/<POOL>/apps/zerotwo/data:/data                    # <-- EDIT pool
       # no host port — only nginx talks to it, on the app's internal network

     zerotwo-nginx:
       image: nginx:alpine
       restart: unless-stopped
       depends_on: [zerotwo-api]
       ports:
         - "30080:80"     # LAN/VPN test + tunnel target: http://192.168.1.83:30080
       volumes:
         - /mnt/<POOL>/apps/zerotwo/nginx.truenas.conf:/etc/nginx/conf.d/default.conf:ro  # <-- EDIT pool
   ```
4. Deploy, then **test on the LAN** (over your WireGuard VPN if remote):
   ```sh
   curl http://192.168.1.83:30080/api/health           # -> {"ok":true}
   ```
   Don't port-forward `30080` to the internet — the public path is the tunnel in
   Part C. (`CF-Connecting-IP` trust assumes the only public ingress is the proxy.)

If you'd rather skip nginx, you can run only `zerotwo-api` and point the tunnel
straight at it — Node still enforces per-IP/day + honeypot + caps. nginx just adds
edge `limit_req` flood-absorption (recommended).

---

## Part C — Expose it publicly with Cloudflare Tunnel (recommended)

No port-forwarding, no exposed home IP, free TLS.

1. **Move the domain's DNS to Cloudflare** (free): add the site at
   dash.cloudflare.com, then change the nameservers at your registrar to the two
   Cloudflare gives you. Your SiteGround site keeps working — just make sure an
   `A`/`CNAME` record for the root/`www` points at SiteGround (set it **DNS only**,
   grey cloud, so SiteGround's own HTTPS handles the page).
2. **Create a tunnel:** Cloudflare **Zero Trust → Networks → Tunnels → Create a
   tunnel** (type *Cloudflared*). Copy the **tunnel token**.
3. **Run cloudflared on TrueNAS** — add a third service to the same Custom App
   (Edit the app's YAML):
   ```yaml
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       depends_on: [zerotwo-nginx]
       command: tunnel --no-autoupdate run --token PASTE_TUNNEL_TOKEN   # <-- EDIT
   ```
4. **Add a Public Hostname** to the tunnel (in the Cloudflare dashboard):
   - **Subdomain:** `api` · **Domain:** `zerotwosystems.nl`
   - **Service:** `http://zerotwo-nginx:80`  (same app network)
     — or `http://192.168.1.83:30080` if you prefer.

   Cloudflare auto-creates the `api.zerotwosystems.nl` DNS record.

> Alternative without Cloudflare: forward router `443 → 192.168.1.83:30080`, give
> nginx a TLS cert for `api.zerotwosystems.nl` (Let's Encrypt DNS-01), add an `A`
> record to your home IP (+ DDNS if dynamic). More moving parts and it exposes
> your IP, so the tunnel is the cleaner option.

---

## Part D — Verify end to end

```sh
# health, through the public URL
curl https://api.zerotwosystems.nl/api/health            # -> {"ok":true}

# CORS preflight is allowed for your page origin
curl -i -X OPTIONS https://api.zerotwosystems.nl/api/request \
  -H "Origin: https://zerotwosystems.nl" \
  -H "Access-Control-Request-Method: POST"
# -> 204, with: access-control-allow-origin: https://zerotwosystems.nl
```

Then on the live page:
1. Open **Request access**, submit once → "request received". Submit again →
   blocked with a countdown (now the *real* server-side per-IP limit).
2. Unlock (click **LOCKED** → enter your passphrase) → **INBOX** shows the request
   with the real visitor IP; approve/deny/delete works.

If the panel still says **demo mode**, the page can't reach the API — re-check the
`<meta>` URL, that `CORS_ORIGIN` exactly matches the page's origin (scheme + host,
no trailing slash), and that `https://api…/api/health` works.

---

## Things to keep in mind

- **Operator key in two places.** The dashboard's `OPERATOR_KEY_SHA256` (in the
  HTML) and the backend's `OPERATOR_KEY_SHA256` env must be the **same hash**, or
  the inbox won't authenticate. Default is `sha256("zerotwo")` — change both.
- **LAN service tiles will read "down" on the public page.** TrueNAS/Jellyfin/etc.
  are `http://192.168.1.83:…`; a visitor's browser can't reach your LAN, and an
  HTTPS page can't ping `http://` targets (mixed content) anyway. Use each tile's
  **force-up / hide** status option in EDIT mode for those. (Status checks are
  browser-side by design — this is expected, not a bug.)
- **Updating the backend:** edit `server.js` on the dataset and restart the app
  (the file is mounted read-only into the container).
- **Backups:** `…/apps/zerotwo/data/requests.json` is your request history — include
  it in your TrueNAS snapshots if you care about it.
