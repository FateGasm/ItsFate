// Full-page screenshots of each route at each width, plus an SEO audit and
// link check piggybacked on the widest (desktop) pass. Writes index.html to
// view screenshots side by side, SEO issues, and broken links.
// Usage: dev server running, then `node playwright/analysis.mjs`. Open playwright/screenshots/index.html.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(out, { recursive: true });
const base = process.env.URL ?? "http://localhost:4321";
const widths = [390, 640, 768, 834, 1024];
const auditWidth = widths[widths.length - 1]; // reuse this pass for SEO + links

const b = await chromium.launch();

// Discover routes: BFS same-origin <a href> from "/". Only linked pages are found,
// which matches what a visitor (and a crawler) can reach.
const pages = {};
{
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    const queue = ["/"];
    const seen = new Set(queue);
    while (queue.length) {
        const path = queue.shift();
        pages[path === "/" ? "home" : path.replace(/^\/|\/$/g, "").replace(/\//g, "-")] = path;
        await p.goto(base + path, { waitUntil: "domcontentloaded" });
        const hrefs = await p.$$eval("a[href]", (as) => as.map((a) => a.href));
        for (const h of hrefs) {
            const u = new URL(h);
            if (u.origin !== new URL(base).origin) continue;
            const clean = u.pathname.replace(/\/$/, "") || "/";
            if (/\.\w+$/.test(clean)) continue; // files (resume.pdf), not pages
            if (!seen.has(clean)) {
                seen.add(clean);
                queue.push(clean);
            }
        }
    }
    await ctx.close();
    console.log("routes:", Object.values(pages).join(" "));
}

const seoResults = [];
const allLinks = new Map(); // url -> Set of page names it appeared on

for (const w of widths) {
    const ctx = await b.newContext({
        viewport: { width: w, height: w < 700 ? 844 : 1024 },
        hasTouch: w < 700,
        reducedMotion: "reduce",
    });
    const p = await ctx.newPage();

    const consoleErrors = [];
    p.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    p.on("pageerror", (err) => consoleErrors.push(String(err)));

    for (const [name, path] of Object.entries(pages)) {
        consoleErrors.length = 0;
        await p.goto(base + path, { waitUntil: "networkidle" });
        // Dev /_image transforms are slow on a cold server; force lazy images and wait for decode
        await p.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
        await p.evaluate(() =>
            Promise.all(
                [...document.images].map((img) => {
                    img.loading = "eager";
                    return img.decode().catch(() => {});
                }),
            ),
        );
        await p.screenshot({ path: join(out, `${name}-${w}.png`), fullPage: true });

        if (w === auditWidth) {
            const audit = await auditPage(p, name, path, base);
            audit.consoleErrors = [...consoleErrors];
            audit.issues = computeIssues(audit);
            seoResults.push(audit);
            for (const link of audit.links) {
                if (!allLinks.has(link)) allLinks.set(link, new Set());
                allLinks.get(link).add(name);
            }
        }
    }
    await ctx.close();
}

// --- link check: one deduped pass over every href found across all pages ---
const linkCtx = await b.newContext();
const linkResults = [];
for (const [url] of allLinks) {
    if (/^(mailto:|tel:|javascript:|#)/.test(url)) continue;
    let status = null;
    let error = null;
    try {
        const res = await linkCtx.request.get(url, { timeout: 8000 });
        status = res.status();
    } catch (e) {
        error = String(e.message || e).split("\n")[0];
    }
    linkResults.push({ url, status, error, foundOn: [...allLinks.get(url)] });
}
await linkCtx.close();
await b.close();

// --- SEO extraction + rules ---
async function auditPage(page, name, path, base) {
    const data = await page.evaluate(() => {
        const meta = (sel) => document.querySelector(sel)?.content ?? null;
        const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? null;
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName);
        const images = [...document.images].map((img) => ({
            src: img.currentSrc || img.src,
            hasAlt: img.hasAttribute("alt"),
        }));
        const links = [...document.querySelectorAll("a[href]")].map((a) => a.href);
        const text = document.body.innerText || "";
        return {
            title: document.title || null,
            metaDescription: meta('meta[name="description"]'),
            canonical: attr('link[rel="canonical"]', "href"),
            ogTitle: meta('meta[property="og:title"]'),
            ogDescription: meta('meta[property="og:description"]'),
            ogImage: meta('meta[property="og:image"]'),
            twitterCard: meta('meta[name="twitter:card"]'),
            jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
            lang: document.documentElement.lang || null,
            headings,
            images,
            links,
            wordCount: text.trim().split(/\s+/).filter(Boolean).length,
        };
    });
    return { name, path, url: base + path, ...data };
}

function computeIssues(d) {
    const issues = [];
    if (!d.title) issues.push("missing <title>");
    else if (d.title.length > 60) issues.push(`title is ${d.title.length} chars (>60)`);
    if (!d.metaDescription) issues.push("missing meta description");
    else if (d.metaDescription.length > 160) issues.push(`meta description is ${d.metaDescription.length} chars (>160)`);
    if (!d.canonical) issues.push("missing canonical link");
    if (!d.ogTitle) issues.push("missing og:title");
    if (!d.ogDescription) issues.push("missing og:description");
    if (!d.ogImage) issues.push("missing og:image");
    if (!d.twitterCard) issues.push("missing twitter:card");
    if (!d.lang) issues.push("missing <html lang>");
    const h1s = d.headings.filter((h) => h === "H1").length;
    if (h1s === 0) issues.push("no <h1>");
    if (h1s > 1) issues.push(`${h1s} <h1> tags (should be 1)`);
    const noAlt = d.images.filter((i) => !i.hasAlt).length;
    if (noAlt > 0) issues.push(`${noAlt} image(s) missing alt text`);
    if (d.name !== "home" && d.wordCount < 100) issues.push(`low word count (${d.wordCount})`);
    if (d.consoleErrors?.length) issues.push(`${d.consoleErrors.length} console error(s)`);
    return issues;
}

// --- HTML output ---
const strip = (name, path) => `
<h2>${name}<code>${path}</code></h2>
<div class="strip">${widths
    .map(
        (w) => `<figure><figcaption><b>${w}</b> px</figcaption>
<div class="frame" tabindex="0" style="width:${w / 2}px"><img src="${name}-${w}.png" width="${w / 2}" alt="${name} at ${w}px"></div></figure>`,
    )
    .join("")}</div>`;

const seoRow = (d) => `<tr class="${d.issues.length ? "fail" : "pass"}">
<td><b>${d.name}</b><br><code>${d.path}</code></td>
<td>${d.title ?? "<em>none</em>"}<br><span class="muted">${d.title?.length ?? 0} chars</span></td>
<td>${d.metaDescription ?? "<em>none</em>"}<br><span class="muted">${d.metaDescription?.length ?? 0} chars</span></td>
<td>${d.wordCount}</td>
<td>${d.issues.length ? `<ul>${d.issues.map((i) => `<li>${i}</li>`).join("")}</ul>` : "✓ none"}</td>
</tr>`;

const linkRow = (l) => `<tr class="${l.error || (l.status && l.status >= 400) ? "fail" : "pass"}">
<td><a href="${l.url}">${l.url}</a></td>
<td>${l.error ? `error: ${l.error}` : l.status}</td>
<td>${l.foundOn.join(", ")}</td>
</tr>`;

const brokenLinks = linkResults.filter((l) => l.error || (l.status && l.status >= 400));

writeFileSync(
    join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>ItsFate Viewport Check</title>
<style>
:root{--bg:#09090b;--fg:#f4f4f5;--muted:#a1a1aa;--border:#27272a;--accent:#a78bfa;--surface:#18181b;--ok:#4ade80;--bad:#f87171}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;padding:32px 24px 48px;max-width:1600px}
h1{font-size:1.6rem;margin:0 0 4px}
p{color:var(--muted);margin:0 0 24px;max-width:65ch}
h2{font-size:1.1rem;margin:40px 0 12px}
h2 code{font:.85em ui-monospace,Consolas,monospace;color:var(--muted);font-weight:400;margin-left:8px}
.strip{display:flex;gap:20px;overflow-x:auto;padding-bottom:12px;align-items:flex-start}
figure{margin:0;flex:0 0 auto}
figcaption{font:600 .8rem/1 ui-monospace,Consolas,monospace;color:var(--muted);margin-bottom:8px}
figcaption b{color:var(--accent)}
.frame{max-height:640px;overflow-y:auto;border:1px solid var(--border);background:var(--surface);border-radius:4px}
.frame img{display:block}
.frame:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin-bottom:16px}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--surface);color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
tr.fail td:last-child{color:var(--bad)}
tr.pass td:last-child{color:var(--ok)}
.muted{color:var(--muted);font-size:.8rem}
ul{margin:0;padding-left:18px}
</style>
<h1>ItsFate Viewport Check</h1>
<p>${new Date().toLocaleString()} · ${base}. </p>
<p>Half scale, scroll inside a frame for the rest. Frames under 700px ran with touch emulation. SEO audit and link check ran at ${auditWidth}px.</p>
${Object.entries(pages).map(([n, p]) => strip(n, p)).join("")}

<h2>SEO Audit</h2>
<table>
<tr><th>Page</th><th>Title</th><th>Meta description</th><th>Words</th><th>Issues</th></tr>
${seoResults.map(seoRow).join("")}
</table>

<h2>Link Check${brokenLinks.length ? ` <span class="muted">(${brokenLinks.length} broken)</span>` : ""}<code>${allLinks.size} unique links</code></h2>
<table>
<tr><th>URL</th><th>Status</th><th>Found on</th></tr>
${linkResults.sort((a, b2) => (a.error || a.status >= 400 ? -1 : 1) - (b2.error || b2.status >= 400 ? -1 : 1)).map(linkRow).join("")}
</table>`,
);
console.log("wrote", join(out, "index.html"));
console.log(`SEO: ${seoResults.filter((r) => r.issues.length).length}/${seoResults.length} pages with issues`);
console.log(`Links: ${brokenLinks.length}/${linkResults.length} broken`);
