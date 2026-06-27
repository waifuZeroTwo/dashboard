# ZeroTwo Systems  -  request backend

A tiny, zero-dependency Node service that powers the dashboard's **Request access**
panel and the operator **inbox**. It is what actually makes "one request per day,
no botting, no crashing" *true*  -  the in-page limit is only a soft deterrent.

## What it guarantees

- **One request per IP per rolling 24 hours**  -  enforced server-side (the browser
  can't fake or clear this).
- **Bots can't flood it:** nginx `limit_req` drops a flood at the edge before it
  reaches Node; the app also rejects a filled honeypot field and forms submitted
  faster than a human could (`< 1.2s`).
- **The site can't be filled/crashed:** 4 KB body cap, strict per-field length
  caps, a max of 500 pending / 5000 total stored rows (returns `503` past that),
  and the per-IP rate map is pruned hourly so memory/disk stay bounded.
- **Operator endpoints are really protected:** `GET /api/requests` and
  `POST /api/request/resolve` require `Authorization: Bearer <passphrase>`; the
  server compares `sha256(passphrase)` to `OPERATOR_KEY_SHA256` in constant time.
  No plaintext is ever stored.

## 1. Set your operator key

Use the SAME passphrase as the dashboard. Get its hash:

```sh
printf '%s' 'your operator passphrase' | shasum -a 256
# (or run `passwd your passphrase` inside the dashboard console)
```

## 2. Run it (behind nginx, on localhost)

```sh
OPERATOR_KEY_SHA256=<your-hash> PORT=8787 DATA_DIR=/var/lib/zerotwo node backend/server.js
```

Requests are written to `DATA_DIR/requests.json`; rate state to `ratelimit.json`.

### Env vars

| Var                   | Default       | Purpose                                                        |
|-----------------------|---------------|----------------------------------------------------------------|
| `OPERATOR_KEY_SHA256` | sha256(zerotwo) | Operator-inbox auth; **must match the dashboard's** hash.    |
| `PORT` / `HOST`       | 8787 / 127.0.0.1 | Listen address. Use `HOST=0.0.0.0` inside a container.       |
| `DATA_DIR`            | ./data        | Where `requests.json` / `ratelimit.json` are persisted.        |
| `CORS_ORIGIN`         | (none)        | Comma-separated page origins allowed to call the API from a browser. Needed only for **split hosting** (page and backend on different hosts). Empty = same-origin only. |

> Behind a proxy/tunnel the backend reads the real visitor IP from
> `CF-Connecting-IP`, then `X-Real-IP`, then `X-Forwarded-For`  -  so the per-IP
> limit keys on the visitor, not the proxy. See `../DEPLOY-siteground-truenas.md`
> for the split page-on-SiteGround / backend-on-TrueNAS walkthrough.

### Keep it running with systemd

```ini
# /etc/systemd/system/zerotwo-requests.service
[Unit]
Description=ZeroTwo request backend
After=network.target

[Service]
Environment=OPERATOR_KEY_SHA256=<your-hash>
Environment=PORT=8787
Environment=DATA_DIR=/var/lib/zerotwo
ExecStart=/usr/bin/node /var/www/zerotwo/backend/server.js
Restart=always
DynamicUser=yes
StateDirectory=zerotwo

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now zerotwo-requests
```

## 3. Wire up nginx

Copy the zones + locations from `nginx.conf.example` into your site config
(the `limit_req_zone` lines go in the `http{}` block). Reload:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

That's it. The dashboard auto-detects the backend: when `/api/request` responds
it uses real data; with no backend it falls back to a clearly-labelled **demo
mode** (localStorage) so you can preview the flow.

## Endpoints

| Method | Path                    | Auth      | Purpose                          |
|--------|-------------------------|-----------|----------------------------------|
| POST   | `/api/request`          | public    | submit an account request        |
| GET    | `/api/requests`         | Bearer    | operator: list all requests      |
| POST   | `/api/request/resolve`  | Bearer    | operator: approve/deny/delete    |
| GET    | `/api/health`           | public    | liveness check                   |

## Tuning

All limits are constants at the top of `server.js`: `DAY_MS`, `MAX_BODY`,
`MAX_PENDING`, `MAX_TOTAL`, `MIN_FORM_MS`, `ALLOWED_SERVICES`, `LIMITS`.
