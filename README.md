# ItsFate
Personal blog/portfolio to learn and explore [Astro](https://astro.build/).

Live at https://itsfate.fategasm.workers.dev/ (custom domain soon)

## Stack
Astro 7 + Tailwind + MDX. Deployed as Cloudflare Workers static assets.

## Dev tools
`node playwright/analysis.mjs` screenshots every route at 5 viewport widths (390–1024px), runs an SEO + broken-link audit on desktop pass. Outputs to `playwright/screenshots/index.html`.

Resume viewer uses vendored [PDF.js](https://mozilla.github.io/pdf.js/) in `public/pdfjs/`. Not an npm dep, copied by hand. License in `public/pdfjs/LICENSE`.
