# Cloaked Innovations Limited — Website

Static site, ready to deploy to Vercel. No build step required (plain HTML/CSS/JS, single file).

## Files

- `index.html` — the entire site (all "pages" are hash-routed sections in one file)
- `robots.txt` — points crawlers to the sitemap
- `sitemap.xml` — lists the homepage and each section
- `404.html` — shown for any URL that doesn't resolve
- `vercel.json` — basic security headers + caching rules

## Deploy to Vercel

**Option A — Vercel dashboard (no CLI needed)**
1. Go to https://vercel.com/new
2. Choose "Deploy without Git" / drag-and-drop, and upload this folder (or the unzipped contents)
3. Framework preset: **Other** (static site) — no build command, no output directory override needed
4. Click **Deploy**

**Option B — Vercel CLI**
```bash
npm i -g vercel
cd cloaked-innovations-site
vercel --prod
```

## Connect the domain: cloakedinnovations.co.ke

1. In the Vercel project, go to **Settings → Domains**
2. Add `cloakedinnovations.co.ke` (and optionally `www.cloakedinnovations.co.ke` as a redirect to the apex)
3. Vercel will show DNS records to add at your domain registrar. For an apex domain, it's typically:
   - **A record**: `@` → `76.76.21.21`
   - or **ALIAS/ANAME**: `@` → `cname.vercel-dns.com` (if your registrar supports it)
   - For `www`: **CNAME** `www` → `cname.vercel-dns.com`
   
   *(Vercel shows the exact current values on the Domains page — use those over this README if they differ.)*
4. Wait for DNS propagation (can take a few minutes to a few hours) and for Vercel to issue the SSL certificate automatically

## After going live

- Double-check `index.html`, `robots.txt`, and `sitemap.xml` all reference `https://cloakedinnovations.co.ke/` (they already do)
- Submit `https://cloakedinnovations.co.ke/sitemap.xml` in Google Search Console
- Replace the sample/demo product categories on the Products section with the confirmed catalogue when ready
- The contact form opens the visitor's email app (mailto) since this is a static site with no backend — if you'd like real form submissions captured server-side later, that would need a small serverless function or a form service, which Vercel supports
