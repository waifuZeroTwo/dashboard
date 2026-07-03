# build/  -  regenerate `index.html`

You only need this folder if you want to **edit the dashboard's source** and
rebuild the single-file output. For day-to-day use you can ignore it  -  tiles,
logos, and the operator passphrase are all editable in-page, and the shipped
`../index.html` already contains everything.

## What it does

The dashboard is authored as small React components in `src/`. This tooling
precompiles the JSX (Babel, classic runtime → `React.createElement`) and inlines
the result **plus React's production build and the CSS** into one self-contained
HTML file at the project root. The output has **no CDN dependency and no
in-browser transpilation**  -  it just runs.

## Usage

```sh
cd build
npm install          # React + Babel + jsdom (one time)
npm run build        # -> writes ../index.html
npm test             # headless jsdom checks: mount, auth gate, console, requests
npm run rebuild      # build + test
```

## Files

| File                  | Purpose                                                        |
|-----------------------|----------------------------------------------------------------|
| `src/*.jsx`, `*.css`  | The dashboard source (components, terminal, requests, styles). |
| `src/sha256.js`       | Tiny SHA-256 used for the operator-key check (inlined as-is).  |
| `assemble.js`         | Inlines React + sha256 + compiled JS + CSS into one HTML file. |
| `smoke-test.js`       | Boots the built file in jsdom; asserts the UI mounts cleanly.  |
| `interactive-test.js` | Drives the auth gate + NEXUS-SH console + request panel.       |

## Common edits

- **Change the seed services / clusters:** edit `SEED` and `CAT_ORDER` in
  `src/app.jsx`, then `npm run build`.
- **Change the operator key:** update the backend operator-key configuration only,
  then `npm run build` if frontend assets changed. Do not put an operator key,
  admin token, or operator-key hash in frontend source or config.
- **Restyle:** edit `src/terminal.css` and rebuild.
