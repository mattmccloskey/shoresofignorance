# Shores Of Ignorance

Weekly Podcast — [shoresofignorance.com](https://shoresofignorance.com)

## Local-Build Workflow

This site is built **locally** and deployed to Cloudflare Pages as static assets. Cloudflare Pages does **not** run a build command for this repo.

### Making changes

1. **Sync episode data** (pulls latest from SoundCloud / sources):
   ```bash
   npm run sync
   ```

2. **Build the site** (generates `index.html`, `episodes/*/index.html`, OG images, etc.):
   ```bash
   npm run build
   ```

3. **Verify the build is fresh** (catches forgotten builds before commit):
   ```bash
   npm run verify
   ```

4. **Commit and push** the generated files, including `site/`:
   ```bash
   git add episodes.json episodes/ index.html sitemap.xml llms.txt site/
   git commit -m "..."
   git push
   ```

The build copies only the publishable files (pages, assets, OG images, `style.css`, `main.js`, `sitemap.xml`, `llms.txt`, `robots.txt`) into `site/`, listed in `site-files.mjs`. Cloudflare serves `site/`, not the repo root, so build scripts, `episodes.json`, `package.json`, etc. are never published. Cloudflare Pages will deploy the committed `site/` folder automatically.

> **Note:** Matt must clear the build command in the Cloudflare Pages dashboard (set it to empty) so Cloudflare does not try to run `npm run build` on its own, and set the build output directory to `site`.
