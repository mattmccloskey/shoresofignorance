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

4. **Commit and push** the generated files:
   ```bash
   git add episodes.json episodes/ index.html
   git commit -m "..."
   git push
   ```

Cloudflare Pages will deploy the committed static files automatically.

> **Note:** Matt must clear the build command in the Cloudflare Pages dashboard (set it to empty) so Cloudflare does not try to run `npm run build` on its own.
