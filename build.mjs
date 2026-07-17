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

const INDEX_PATH = './index.html';
const EPISODES_JSON = './episodes.json';
const EPISODES_DIR = './episodes';

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
  const ogImage = 'https://shoresofignorance.com/assets/soi-hero-banner.png';

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
          ${ep.url ? `<a href="${htmlEscape(ep.url)}" class="btn btn-primary" target="_blank" rel="noopener">🎧 Listen on SoundCloud</a>` : ''}
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

async function shouldRegenerate(ep, epDir) {
  const pagePath = join(epDir, 'index.html');
  try {
    const s = await stat(pagePath);
    const pageMtime = s.mtime.getTime();
    const jsonUpdated = new Date(ep.updatedAt).getTime();
    return jsonUpdated > pageMtime;
  } catch {
    // Page doesn't exist — needs generation
    return true;
  }
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

  // Generate episode detail pages
  console.log('Generating episode detail pages...');
  let generated = 0;
  let skipped = 0;

  for (const ep of episodes) {
    if (ep.number === 0) {
      console.log(`  → skipping episode with no number: ${ep.title}`);
      continue;
    }

    const epDir = join(EPISODES_DIR, String(ep.number));
    const needsBuild = await shouldRegenerate(ep, epDir);

    if (!needsBuild) {
      skipped++;
      continue;
    }

    await mkdir(epDir, { recursive: true });
    const detailHtml = renderDetailPage(ep);
    await writeFile(join(epDir, 'index.html'), detailHtml, 'utf8');
    generated++;
    console.log(`  → episodes/${ep.number}/index.html`);
  }

  console.log(`Generated ${generated} pages, skipped ${skipped} (up-to-date).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
