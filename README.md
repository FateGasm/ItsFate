# ItsFate
Personal blog/portfolio to learn and explore [Astro](https://astro.build/).

Plan to host live site once content is ready.

### Stack
Astro 7 + Tailwind, deployed via Cloudflare Pages

### Dev tools
`node playwright/analysis.mjs` — dev server running first. Screenshots every route at 5 viewport widths (390–1024px), plus SEO + broken-link audit on desktop pass. Output: `playwright/screenshots/index.html`.

Resume viewer uses vendored [PDF.js](https://mozilla.github.io/pdf.js/) (`public/pdfjs/`) — manual copy, not an npm dep. License in `public/pdfjs/LICENSE`.
