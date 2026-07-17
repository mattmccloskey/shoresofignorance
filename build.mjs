#!/usr/bin/env node
/**
 * Build script for shoresofignorance.com
 *
 * Reads episodes.json (the single source of truth) and bakes static HTML:
 * - Updates index.html with latest episode info and episode cards
 * - Generates per-episode detail pages in episodes/{number}/index.html
 *
 * This script is Cloudflare Pages compatible — it only reads files within
 * the repo (episodes.json, index.html, style.css, etc.).
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const INDEX_PATH = './index.html';
const EPISODES_JSON = './episodes.json';
const EPISODES_DIR = './episodes';
const ASSETS_DIR = './assets';
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

function htmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function truncate(text, maxChars = 220) {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed) + '…';
}

function renderCard(ep) {
  const date = formatDate(ep.date);
  const meta = `Episode ${ep.number} · ${date}${ep.durationMinutes ? ' · ' + ep.durationMinutes + ' min' : ''}`;
  const detailUrl = `./episodes/${ep.number}/`;

  return `        <article class="episode-card">
          <div class="episode-number">${ep.number}</div>
          <div class="episode-info">
            <h3><a href="${htmlEscape(detailUrl)}">${htmlEscape(ep.title)}</a></h3>
            <p>${htmlEscape(ep.description)}</p>
            <span class="meta">${htmlEscape(meta)}</span>
          </div>
          <div class="episode-actions">
            <a href="${htmlEscape(detailUrl)}" class="btn btn-ghost">Details</a>
            ${ep.url ? `<a href="${htmlEscape(ep.url)}" class="btn btn-ghost" target="_blank" rel="noopener">Listen</a>` : '<span class="btn btn-ghost disabled">Soon</span>'}
          </div>
        </article>`;
}

function renderDetailPage(ep) {
  const date = formatDate(ep.date);
  const meta = `Episode ${ep.number} · ${date}${ep.durationMinutes ? ' · ' + ep.durationMinutes + ' min' : ''}`;
  const ogDesc = truncate((ep.fullDescription || ep.description).replace(/<[^>]+>/g, ' '), 160);
  const ogImage = `https://shoresofignorance.com/episodes/${ep.number}/og-image.png`;

  let quotesHtml = '';
  if (ep.keyQuotes && ep.keyQuotes.length > 0) {
    const quoteCards = ep.keyQuotes.map(q => {
      const attr = [q.speaker, q.timestamp].filter(Boolean).join(', ');
      return `          <blockquote class="detail-quote">
            <p>${htmlEscape(q.text)}</p>
            ${attr ? `<cite>— ${htmlEscape(attr)}</cite>` : ''}
          </blockquote>`;
    }).join('\n');
    quotesHtml = `
        <section class="detail-section">
          <h2>Key Quotes</h2>
          <div class="quote-list">
${quoteCards}
          </div>
        </section>`;
  }

  let resourcesHtml = '';
  if (ep.resources && ep.resources.length > 0) {
    const resourceItems = ep.resources.map(r => {
      const url = r.url ? ` <a href="${htmlEscape(r.url)}" target="_blank" rel="noopener">Link ↗</a>` : '';
      return `            <li>
              <strong>${htmlEscape(r.title)}</strong>${r.description ? ` — ${htmlEscape(r.description)}` : ''}${url}
            </li>`;
    }).join('\n');
    resourcesHtml = `
        <section class="detail-section">
          <h2>Resources & References</h2>
          <ul class="resource-list">
${resourceItems}
          </ul>
        </section>`;
  }

  let factChecksHtml = '';
  if (ep.factChecks && ep.factChecks.length > 0) {
    const factItems = ep.factChecks.map(f => {
      const statusLower = f.status.toLowerCase();
      const statusClass = statusLower.includes('verified') || statusLower.includes('confirmed') || statusLower.includes('true')
        ? 'status-verified'
        : statusLower.includes('disputed') || statusLower.includes('unverified') || statusLower.includes('incorrect') || statusLower.includes('false')
        ? 'status-disputed'
        : 'status-neutral';
      return `            <li>
              <p class="fact-claim">${htmlEscape(f.claim)}</p>
              <span class="fact-status ${statusClass}">${htmlEscape(f.status)}</span>
            </li>`;
    }).join('\n');
    factChecksHtml = `
        <section class="detail-section">
          <h2>Fact Checks</h2>
          <ul class="fact-list">
${factItems}
          </ul>
        </section>`;
  }

  let nextEpisodeHtml = '';
  if (ep.futureThreads && ep.futureThreads.length > 0) {
    const topicItems = ep.futureThreads.map(t =>
      `            <li>
              <strong>${htmlEscape(t.title)}</strong>
              <p>${htmlEscape(t.body.replace(/\*\*/g, ''))}</p>
            </li>`
    ).join('\n');
    nextEpisodeHtml = `
        <section class="detail-section">
          <h2>Threads for Future Episodes</h2>
          <ul class="topic-list">
${topicItems}
          </ul>
        </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEscape(ep.title)} — Shores of Ignorance Ep ${ep.number}</title>
  <meta name="description" content="${htmlEscape(ogDesc)}">
  <meta property="og:title" content="${htmlEscape(ep.title)} — Shores of Ignorance Ep ${ep.number}">
  <meta property="og:description" content="${htmlEscape(ogDesc)}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="https://shoresofignorance.com/episodes/${ep.number}/">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(ep.title)} — Shores of Ignorance Ep ${ep.number}">
  <meta name="twitter:description" content="${htmlEscape(ogDesc)}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cardo:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../style.css">
  <link rel="icon" href="../../assets/soi-brand-icon.svg" type="image/svg+xml">
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a href="../../" class="logo">
        <img src="../../assets/soi-badge-white.svg" alt="Shores of Ignorance">
      </a>
      <nav class="site-nav" aria-label="Primary">
        <a href="../../#latest" class="latest">Latest</a>
        <a href="../../#episodes">Episodes</a>
        <a href="../../#about">About</a>
        <a href="../../#subscribe">Subscribe</a>
        <a href="../../#find-us">Find Us</a>
      </nav>
    </div>
  </header>

  <main>
    <article class="episode-detail">
      <div class="container">
        <div class="detail-header">
          <a href="../../#episodes" class="back-link">← All Episodes</a>
          <p class="eyebrow">Episode ${ep.number}</p>
          <h1 class="episode-title">${htmlEscape(ep.title)}</h1>
          <p class="episode-meta">${htmlEscape(meta)}</p>
          ${ep.url || ep.appleUrl || ep.spotifyUrl ? `
          <div class="listen-buttons">
            <span class="listen-label">Episode available on</span>
            <div class="listen-row">
              ${ep.url ? `<a href="${htmlEscape(ep.url)}" class="btn btn-primary" target="_blank" rel="noopener">🎧 SoundCloud</a>` : ''}
              ${ep.appleUrl ? `<a href="${htmlEscape(ep.appleUrl)}" class="btn btn-apple" target="_blank" rel="noopener">🍎 Apple Podcasts</a>` : ''}
              ${ep.spotifyUrl ? `<a href="${htmlEscape(ep.spotifyUrl)}" class="btn btn-spotify" target="_blank" rel="noopener">🎵 Spotify</a>` : ''}
            </div>
          </div>` : ''}
        </div>

        <section class="detail-section">
          <h2>About This Episode</h2>
          <div class="detail-description">
            <p>${htmlEscape(ep.fullDescription || ep.description)}</p>
          </div>
        </section>
${quotesHtml}${resourcesHtml}${factChecksHtml}${nextEpisodeHtml}
      </div>
    </article>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>&copy; <span id="year"></span> Shores of Ignorance. All rights reserved.</p>
      <div class="footer-links">
        <a href="mailto:hello@shoresofignorance.com">hello@shoresofignorance.com</a>
      </div>
    </div>
  </footer>

  <script src="../../main.js"></script>
</body>
</html>`;
}

async function shouldRegenerate(ep, epDir, fileName = 'index.html') {
  const pagePath = join(epDir, fileName);
  try {
    const s = await stat(pagePath);
    const pageMtime = s.mtime.getTime();
    const jsonUpdated = new Date(ep.updatedAt).getTime();
    return jsonUpdated > pageMtime;
  } catch {
    // File doesn't exist — needs generation
    return true;
  }
}

// ── OG Image Generation ──

let _badgeSvg = null;
async function loadBadgeSvg() {
  if (_badgeSvg) return _badgeSvg;
  const svg = await readFile(join(ASSETS_DIR, 'soi-badge-white.svg'), 'utf8');
  // Strip XML declaration and outer <svg> tag so we can embed the inner content
  const inner = svg
    .replace(/<\?xml[^?]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '');
  _badgeSvg = inner;
  return inner;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTitle(title, maxLineLength = 28) {
  const words = title.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLineLength && current.length > 0) {
      lines.push(current.trim());
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

function buildOgSvg({ title, number }) {
  const lines = wrapTitle(title);
  // Scale font size based on line count and longest line
  const longestLine = Math.max(...lines.map(l => l.length));
  let fontSize = 72;
  if (lines.length >= 3 || longestLine > 26) fontSize = 56;
  if (lines.length >= 4 || longestLine > 32) fontSize = 48;
  if (lines.length >= 5 || longestLine > 38) fontSize = 40;

  const lineHeight = fontSize * 1.25;
  const titleBlockHeight = lines.length * lineHeight;
  const badgeSize = 140;
  const gap = 64;
  const subtitleSize = 28;
  const totalHeight = badgeSize + gap + titleBlockHeight + gap + subtitleSize;
  const startY = (OG_HEIGHT - totalHeight) / 2 + badgeSize + gap;

  const titleTspans = lines
    .map((line, i) => `      <tspan x="600" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('\n');

  // Use a unique gradient ID per render to avoid collisions if we ever batch in parallel
  const uid = Math.random().toString(36).slice(2, 8);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bgGrad${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b0c10"/>
      <stop offset="100%" stop-color="#14161c"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bgGrad${uid})"/>
  <g transform="translate(${600 - badgeSize / 2}, ${startY - badgeSize - gap})">
    <svg width="${badgeSize}" height="${badgeSize}" viewBox="0 0 307 307">
      <defs>
        <linearGradient id="paint0_${uid}" x1="15350" y1="0" x2="15350" y2="30700" gradientUnits="userSpaceOnUse">
          <stop stop-color="#BF432D"/>
          <stop offset="0.395508" stop-color="#EB4D2A"/>
          <stop offset="0.757337" stop-color="#666064"/>
          <stop offset="1" stop-color="#3A3642"/>
        </linearGradient>
        <clipPath id="clip0_${uid}">
          <rect width="307" height="307" fill="white"/>
        </clipPath>
      </defs>
      <g clip-path="url(#clip0_${uid})">
        <path d="M153.5 0C238.276 0 307 68.7243 307 153.5C307 238.276 238.276 307 153.5 307C68.7243 307 0 238.276 0 153.5C0 68.7243 68.7243 0 153.5 0ZM154 31C86.069 31 31 86.069 31 154C31 221.931 86.069 277 154 277C221.931 277 277 221.931 277 154C277 86.069 221.931 31 154 31Z" fill="url(#paint0_${uid})"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M190.895 144.523C190.657 153.706 193.646 162.596 193.583 171.829C193.385 200.094 171.625 226.961 142.772 233.861C122.445 238.722 95.3062 227.489 85.8453 210.299C77.1958 194.582 83.5692 173.294 100.634 160.907C109.08 154.776 126.806 153.915 137.123 159.133C148.433 164.855 155.06 177.021 152.53 188.285C151.857 191.283 150.204 194.288 148.243 196.818C146.199 199.457 142.664 201.751 139.207 199.753C135.96 197.876 137.793 194.642 139.229 192.009C142.506 186.001 143.332 180.011 138.918 174.105C128.556 160.24 107.111 161.337 97.9208 176.202C90.7036 187.875 91.6444 201.555 100.3 210.778C113.368 224.701 126.028 228.614 142.295 223.754C162.869 217.608 183.554 195.028 183.264 176.492C183.125 167.583 182.839 158.187 179.269 149.453C177.892 146.082 177.919 142.74 179.199 139.353C180.3 136.437 180.533 132.585 185.555 133.321C190.282 134.014 191.352 137.3 191.142 141.089C191.079 142.235 190.978 143.378 190.895 144.523Z" fill="#ffffff"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M196.82 113.656C205.059 113.919 214.945 107.477 215.015 101.81C215.098 95.1812 210.384 92.4917 204.49 91.9305C198.902 91.3982 189.778 101.234 189.847 107.138C189.905 112.065 193.263 113.335 196.82 113.656ZM92.7006 90.2887C92.7595 89.6174 93.1843 89.0214 93.816 88.7478C102.724 84.8902 112.088 83.5678 122.195 83.5678C138.286 82.8855 149.814 89.6125 161.619 97.9777C174.336 106.989 174.646 107.031 183.678 95.0637C189.344 87.5558 195.732 80.7326 206.752 82.2631C217.959 83.8205 225.862 93.6838 224.65 104.435C223.49 114.728 211.582 122.815 199.947 122.778C182.957 122.724 169.166 116.837 156.008 106.339C135.41 89.9026 114.749 87.9939 94.9359 98.7567C93.6015 99.4819 91.9785 98.4581 92.1096 96.9729L92.7006 90.2887Z" fill="#ffffff"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M193.985 143C178.52 142.954 165.04 138.269 151.561 128.253C133.435 114.787 115.041 112.742 96.8485 122.161C95.548 122.834 93.8976 122.477 93.1001 121.326L92 119.738C102.197 113.91 112.644 111.355 123.049 112.138C133.664 112.938 144.276 117.229 154.589 124.892C167.171 134.241 179.695 138.614 194 138.656L193.985 143Z" fill="#ffffff"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M161.363 122.366C160.9 123.054 160.004 123.204 159.363 122.707C146.977 113.087 135.649 106.709 122.319 106.709C113.765 105.729 104.628 108.829 95.0108 113.468C94.2938 113.814 93.4502 113.488 93.1173 112.722L92.1358 110.465C91.7978 109.688 92.1123 108.753 92.8401 108.403C103.06 103.473 112.679 101.013 122.007 101C137.643 101 151.827 109.931 162.41 118.191C163.051 118.692 163.191 119.657 162.725 120.347L161.363 122.366Z" fill="#ffffff"/>
      </g>
    </svg>
  </g>
  <text x="600" y="${startY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" fill="#e6e1dc">
${titleTspans}
  </text>
  <text x="600" y="${startY + titleBlockHeight + gap}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="#8b8680" letter-spacing="3">
    EPISODE ${number} — SHORES OF IGNORANCE
  </text>
</svg>`;
}

async function generateOgImage(ep, outPath) {
  const svg = buildOgSvg({ title: ep.title, number: ep.number });
  await sharp(Buffer.from(svg))
    .resize(OG_WIDTH, OG_HEIGHT)
    .png()
    .toFile(outPath);
}

async function main() {
  console.log('Reading episodes.json...');
  const raw = await readFile(EPISODES_JSON, 'utf8');
  const episodes = JSON.parse(raw);
  if (!Array.isArray(episodes) || episodes.length === 0) {
    throw new Error('No episodes found in episodes.json');
  }

  // Sort descending for "latest" logic, but keep original order for detail pages
  const sortedDesc = [...episodes].sort((a, b) => b.number - a.number);
  const latest = sortedDesc[0];
  const recent = sortedDesc.slice(0, 6);

  // Update index.html
  let html = await readFile(INDEX_PATH, 'utf8');

  html = html.replace(
    /(<p class="eyebrow" id="latest-eyebrow">)[^<]*(<\/p>)/,
    `$1Latest Episode: ${htmlEscape(latest.title)}$2`
  );

  const latestMeta = `Episode ${latest.number} · ${formatDate(latest.date)}${latest.durationMinutes ? ' · ' + latest.durationMinutes + ' min' : ''}`;
  html = html.replace(
    /(<p class="episode-meta" id="latest-meta">)[\s\S]*?(<\/p>)/,
    `$1${htmlEscape(latestMeta)}$2`
  );

  const playHref = latest.url || '#';
  const playText = latest.url ? 'Listen Now' : 'Coming Soon';
  html = html.replace(
    /(<a href=")#[^"]*(" class="btn btn-primary" id="latest-play">)[^<]*(<\/a>)/,
    `$1${htmlEscape(playHref)}$2${playText}$3`
  );
  if (latest.url && latest.url !== '#') {
    // Only add target/rel if not already present
    if (!html.includes('id="latest-play" target="_blank"')) {
      html = html.replace(
        /(<a href="[^"]*" class="btn btn-primary" id="latest-play")/,
        `$1 target="_blank" rel="noopener"`
      );
    }
  }

  const cardsHtml = recent.map(renderCard).join('\n');
  html = html.replace(
    /<!-- EPISODES_START -->[\s\S]*?<!-- EPISODES_END -->/,
    `<!-- EPISODES_START -->\n${cardsHtml}\n        <!-- EPISODES_END -->`
  );

  html = html.replace(/\s*<!-- Episodes rendered from episodes\.json -->/, '');

  await writeFile(INDEX_PATH, html, 'utf8');
  console.log(`Updated ${INDEX_PATH} with ${episodes.length} episodes (${recent.length} shown).`);

  // Generate episode detail pages + OG images
  console.log('Generating episode detail pages...');
  let generated = 0;
  let skipped = 0;
  let ogGenerated = 0;
  let ogSkipped = 0;

  for (const ep of episodes) {
    if (ep.number === 0) {
      console.log(`  → skipping episode with no number: ${ep.title}`);
      continue;
    }

    const epDir = join(EPISODES_DIR, String(ep.number));
    const needsPage = await shouldRegenerate(ep, epDir, 'index.html');
    const needsOg = await shouldRegenerate(ep, epDir, 'og-image.png');

    await mkdir(epDir, { recursive: true });

    if (needsPage) {
      const detailHtml = renderDetailPage(ep);
      await writeFile(join(epDir, 'index.html'), detailHtml, 'utf8');
      generated++;
      console.log(`  → episodes/${ep.number}/index.html`);
    } else {
      skipped++;
    }

    if (needsOg) {
      const ogPath = join(epDir, 'og-image.png');
      await generateOgImage(ep, ogPath);
      ogGenerated++;
      console.log(`  → episodes/${ep.number}/og-image.png`);
    } else {
      ogSkipped++;
    }
  }

  console.log(`Generated ${generated} pages, skipped ${skipped} (up-to-date).`);
  console.log(`Generated ${ogGenerated} OG images, skipped ${ogSkipped} (up-to-date).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
