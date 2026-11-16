# ZBT Network — Astro

Minimal one-page company presentation migrated from the original Odoo page to **Astro 5**.

## Source of truth

- `src/pages/index.astro` — page content, FAQ and partner logos.
- `src/styles/global.css` — desktop/mobile design and restrained image sizing.
- `public/assets/` — the approved, locally stored brand and partner artwork, including XCITIUM, Telekom, iubenda and SEAP.
- `public/robots.txt` — crawler access to the noindex directive.
- `.github/workflows/deploy-astro.yml` — builds Astro and deploys `dist/` to GitHub Pages.

## Build locally

Use Node.js 22 or later.

```sh
npm install
npm run build
npm run preview
```

The published site is the actual Astro-generated `dist/` output, **not** a manually edited root HTML page.

## Search-engine indexing

The page intentionally includes `noindex, nofollow, noarchive, nosnippet, noimageindex`. There is no sitemap. The robots.txt policy allows the indexers to crawl the page so they can observe `noindex`; blocking it in robots.txt would make the exclusion less reliable.

**This is not private hosting**: the URL and this public GitHub repository are accessible to people who have a link. Do not commit Odoo databases, credentials or customer information.

## Hosting

GitHub Pages uses the GitHub Actions source, publishing the Astro static build on each push to `main`. The custom domain and enforced HTTPS are configured in GitHub Pages settings.
