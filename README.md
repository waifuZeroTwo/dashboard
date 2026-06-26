# ZeroTwo Systems HomeLab Nexus

ZeroTwo Systems HomeLab Nexus is a public-ready start page for self-hosted services. It gives your home lab, media server, personal cloud, or small community a polished landing page with service links, live status, search, a terminal-inspired interface, and an optional account request flow.

The dashboard is designed to be easy to publish. The frontend ships as a single `index.html` file, so you can place it on almost any static web host, reverse proxy, NAS, VPS, or traditional web server. If you want real account request enforcement, the optional Node backend adds rate limiting, bot traps, and an operator inbox.

## Highlights

- Public-facing service directory for Jellyfin, Plex, Nextcloud, Immich, Navidrome, TrueNAS, Home Assistant, network tools, and more.
- Terminal-inspired CRT visual style with green-on-black colors, scanlines, and JetBrains Mono typography.
- Search-first navigation with keyboard shortcuts for fast access to services.
- Service cards grouped by category with status indicators and custom logo support.
- In-page editor for adding, updating, hiding, or removing services without editing HTML by hand.
- Operator lock for admin-only actions such as editing, terminal commands, logo drops, reset controls, and the request inbox.
- Optional account request panel where visitors can request access to selected services.
- Optional backend for real per-IP request limits, bot protection, CORS support, and an authenticated inbox.
- No frontend build step required for normal deployment.

## Screens and experience

The page presents visitors with a simple service portal while still giving operators powerful controls behind a lock.

Visitors can:

- Browse service cards by category.
- Search services from the keyboard.
- Open public service links.
- Submit an account request if the request system is enabled.

Operators can:

- Unlock the console with a passphrase.
- Add, edit, delete, and reorder service entries.
- Drop in custom service logos.
- Review, approve, deny, or delete account requests.
- Use console commands such as `ls`, `open`, `status`, `search`, `add`, `edit`, `rm`, `requests`, `passwd`, `lock`, and `help`.

## Repository contents

```text
index.html                         Main dashboard file for deployment
backend/                           Optional Node backend for account requests
backend/server.js                  Request API with rate limits, bot traps, and operator auth
backend/nginx.conf.example         Example nginx reverse proxy and edge rate limits
backend/nginx.truenas.conf         nginx config for a split SiteGround and TrueNAS setup
backend/README.md                  Backend setup and operations guide
build/                             Optional source and tooling used to regenerate index.html
DEPLOY-siteground-truenas.md       Split-hosting guide for SiteGround, TrueNAS, Cloudflare, and DNS
README.md                          Project overview
```

## Merged handoff additions

This build merges the production dashboard with the newer ZeroTwo handoff design. It keeps the existing dashboard/backend features and adds the Seerr service tile, the public “how to request a movie or show” guide, and matching request-service support in the frontend and backend. The original handoff prototype files are kept under `_handoff_design/` for reference.

## Quick start

### Static dashboard only

Use this option if you only need a public service directory and do not need real server-side account request enforcement.

```sh
cp index.html /var/www/zerotwo/index.html
```

Example nginx site:

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
    root /var/www/zerotwo;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

With only the static frontend deployed, the account request panel runs in demo mode using browser storage. This is useful for previewing the interface, but it is not a secure or enforceable request system.

### Dashboard with real account requests

Use the optional backend when you want public visitors to submit account requests safely.

1. Deploy `index.html` to your web root or static host.
2. Deploy the Node backend from `backend/`.
3. Put nginx, Caddy, Cloudflare Tunnel, or another reverse proxy in front of the backend.
4. Set the operator hash in both the frontend build configuration and backend environment.
5. Configure CORS only if the frontend and backend are on different origins.

Detailed backend instructions are available in [`backend/README.md`](backend/README.md). A complete split-hosting walkthrough is available in [`DEPLOY-siteground-truenas.md`](DEPLOY-siteground-truenas.md).

## Account request system

A static page cannot reliably enforce one request per day, block automated submissions, or protect an operator inbox. Browser storage can be cleared, JavaScript can be bypassed, and bots do not have to follow client-side rules.

For real enforcement, use the backend. It provides:

- One request per IP address per rolling 24-hour window.
- Honeypot and minimum form-time bot checks.
- Request body size limits.
- Pending and total request caps to protect disk usage.
- Atomic file writes.
- Operator-only endpoints protected by the configured SHA-256 passphrase hash.
- CORS controls for split hosting.

## Operator passphrase

The default operator passphrase is `zerotwo`. Change it before publishing the dashboard.

1. Open the dashboard console and unlock it with the current passphrase.
2. Run `passwd your new phrase`.
3. Copy the printed SHA-256 hash.
4. Replace `OPERATOR_KEY_SHA256` in `build/src/app.jsx` with the new hash.
5. Run the build from the `build/` directory to regenerate `index.html`.
6. Set the same hash as the backend `OPERATOR_KEY_SHA256` environment variable if you use the backend.

Only the hash should be stored. Do not publish or commit your real passphrase.

## Hosting options

### Same-origin hosting

Host the dashboard and backend on the same domain. The frontend can call relative `/api/...` paths, and the example nginx config can proxy requests to the Node service.

### Split hosting

Host the dashboard on one provider and the backend somewhere else. For example, the static page can live on SiteGround while the backend runs on TrueNAS behind Cloudflare Tunnel.

For this setup:

- Set `<meta name="zerotwo-api-base">` in the page head to the backend public URL.
- Set the backend `CORS_ORIGIN` value to the frontend origin.
- Follow the guide in [`DEPLOY-siteground-truenas.md`](DEPLOY-siteground-truenas.md).

## Customization

You can tailor the dashboard to match your own home lab or public service portal.

Common changes include:

- Rename the title and subtitle.
- Replace the default service list.
- Add or remove service categories.
- Upload custom logos from the editor.
- Force status indicators on or off for services that cannot be checked from a browser.
- Adjust fonts, colors, and scanline effects in the HTML or source files.
- Rebuild from `build/` if you prefer source-based changes instead of editing the generated HTML.

## Important security notes

- The operator lock protects the dashboard interface from casual visitors, but it is not a substitute for server-side access control.
- Static frontend code can always be inspected by visitors.
- Protect private services with their own authentication, VPN access, SSO, reverse proxy auth, or network rules.
- Use the backend and reverse proxy rate limits for real account request protection.
- Status checks run from the visitor's browser. A service may appear offline if the visitor is not on your LAN or VPN.
- Browsers may block checks to insecure `http://` services when the dashboard is served over HTTPS.
- Dropped logos are stored in browser storage unless you bake them into the page.

## Development

The deployed frontend is `index.html`. The optional source project lives in `build/` for maintainers who want to regenerate the bundled page.

```sh
cd build
npm install
npm run build
```

The backend can be run separately from `backend/`. See [`backend/README.md`](backend/README.md) for environment variables, systemd setup, nginx examples, and operational notes.

## Who this is for

HomeLab Nexus is a good fit for:

- Home lab owners who want one polished entry point for services.
- Families or small groups sharing self-hosted media and cloud tools.
- Operators who want a public landing page with private admin controls.
- NAS, VPS, and reverse proxy setups that benefit from a lightweight static frontend.

## License

Add your project license here before distributing this repository publicly.
