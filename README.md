# ZebraByte — Odoo → Astro

A faithful, minimal static migration of the ZebraByte one-page presentation website shown in the supplied screenshot. The original copy, brand assets and six partner logos were extracted from the supplied Odoo database backup; no Odoo database or application data is included here.

## Requirements

Node.js 20 or later.

## Develop

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The fully static website is generated in `dist/`. No database, API, environment variables or client-side JavaScript are required. FAQ uses built-in HTML `<details>` elements.

## Deploy to Cloudflare Pages

Connect this repository to Cloudflare Workers & Pages → Create application → Pages → Connect to Git.

| Setting | Value |
|---|---|
| Framework preset | Astro |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | 22 (or newer supported Node release) |

The provided `_headers` applies security response headers on Cloudflare Pages. The repository can be kept private while connected through your GitHub integration.

## Notes

- All images are local. Main/partner artwork is taken from the original Odoo asset store.
- The footer retains its appearance; labels without a verified destination are intentionally non-clickable rather than fake links.
- The screenshot's original English copy remains in place for fidelity.
- Do **not** commit the original `.dump`, `.zip`, `filestore` or other Odoo backup files; they can contain private company or customer data.