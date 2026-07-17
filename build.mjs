#!/usr/bin/env node
/**
 * Build script for shoresofignorance.com
 *
 * Fetches the SoundCloud RSS feed and bakes the latest episodes into
 * index.html as static markup. The RSS feed is the single source of truth.
 * Also generates per-episode detail pages in episodes/{number}/index.html.
 */

import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:500028120/sounds.rss';
const INDEX_PATH = './index.html';
const PODCAST_DIR = '/Users/gk/.openclaw/workspace/podcast';
const EPISODES_DIR = './episodes';

function htmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extract(tag, text, fallback = '') {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeEntities(match[1]) : fallback;
}

function parseDuration(iso) {
  const parts = iso.split(':').map(Number);
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  }
  return Math.round(seconds / 60);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function cleanTitle(title) {
  return title.replace(/^Ep\s+\d+:\s*/, '').trim();
}

function truncate(text, maxChars = 220) {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed) + '…';
}

async function findContentFiles(epNumber) {
  const files = await readdir(PODCAST_DIR).catch(() => []);
  const prefix = `Ep_${epNumber}`;
  const result = {};
  for (const f of files) {
    if (f.startsWith(prefix)) {
      if (f.endsWith('_Show_Notes.md')) result.showNotes = join(PODCAST_DIR, f);
      else if (f.endsWith('_Key_Quotes.md')) result.keyQuotes = join(PODCAST_DIR, f);
      else if (f.endsWith('_Description.txt')) result.description = join(PODCAST_DIR, f);
      else if (f.endsWith('_Next_Episode.md')) result.nextEpisode = join(PODCAST_DIR, f);
      else if (f.endsWith('_Transcript.txt')) result.transcript = join(PODCAST_DIR, f);
    }
  }
  return result;
}

function parseKeyQuotes(content) {
  const quotes = [];
  const blocks = content.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    // Skip header lines
    const contentLines = lines.filter(l => !l.match(/^#+\s/) && !l.match(/^\*\*Key Quotes/i) && !l.match(/^\*Generated:/));
    if (contentLines.length < 2) continue;

    // Find quote line: starts with **Quote** header, or contains quoted text
    let quoteLine = contentLines.find(l => l.match(/^\*\*Quote \d*:\*\*\s*"/));
    if (!quoteLine) {
      // Look for line starting with "quoted text" or **"quoted text"**
      quoteLine = contentLines.find(l => {
        const trimmed = l.trim();
        return (trimmed.startsWith('"') && trimmed.includes('"', 1)) ||
               (trimmed.startsWith('**"') && trimmed.includes('"**'));
      });
    }
    if (!quoteLine) continue;

    let text = quoteLine
      .replace(/^\*\*Quote \d*:\*\*\s*/, '')
      .replace(/^\*\*Quote:\*\*\s*/, '')
      .trim();
    // Remove surrounding bold markers and quotes
    text = text.replace(/^\*\*"/, '"').replace(/"\*\*$/, '"');
    text = text.replace(/\*\*/g, '').replace(/\*(?!\s)/g, '');

    // Find attribution line (starts with — or -)
    const attrLine = contentLines.find(l => l.match(/^[-—]\s/));
    let speaker = '';
    let timestamp = '';
    if (attrLine) {
      const attr = attrLine.replace(/^[-—]\s*/, '').trim();
      const m = attr.match(/^(.+?),\s*\[(\d+:\d+)\]$/);
      if (m) {
        speaker = m[1];
        timestamp = m[2];
      } else {
        speaker = attr;
      }
    }

    quotes.push({ text, speaker, timestamp });
  }
  return quotes;
}

function parseShowNotes(content) {
  const sections = {
    resources: [],
    factChecks: [],
  };

  // Extract resources from "## Resources" section (includes subsections like ### Books & Authors)
  const resourcesMatch = content.match(/##\s*Resources?[\s\S]*?(?=\n##\s|##\s*$|$)/i);
  if (resourcesMatch) {
    const block = resourcesMatch[0];
    // Split into bullet items. Each item starts with a bullet and may continue across lines
    // until the next bullet or end of block.
    const items = block.split(/^[-•]\s*/m).slice(1);
    for (const item of items) {
      const lines = item.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      // First line should have a bold title: **Title** — description
      const titleMatch = lines[0].match(/^\*\*(.+?)\*\*(?:\s*—\s*|\s*-\s*|\s*)?(.*)$/);
      if (!titleMatch) continue;

      // Clean markdown italic markers from title
      let title = titleMatch[1].trim().replace(/\*+/g, '').trim();

      // Collect description from remaining text (including continuation lines)
      let description = titleMatch[2].trim();
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^###\s/)) continue;
        description += (description ? ' ' : '') + line;
      }

      // Extract URL from description
      const urlMatch = description.match(/(https?:\/\/[^\s)]+)/);
      const url = urlMatch ? urlMatch[1] : '';
      description = description.replace(/https?:\/\/[^\s)]+/, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
      // Remove leading em-dash or hyphen if present
      description = description.replace(/^[-—]\s*/, '').trim();

      sections.resources.push({ title, description, url });
    }
  }

  // Extract fact checks
  const factMatch = content.match(/##\s*Fact Checks?[\s\S]*?(?=\n##\s|##\s*$|$)/i);
  if (factMatch) {
    const block = factMatch[0];
    const lines = block.split('\n');
    let current = null;
    for (const line of lines) {
      if (line.match(/^##\s/)) continue;
      // Match lines like: - ✅ **Claim text** — explanation **Status: Something**
      const itemMatch = line.match(/^[-•]\s*[✅⚠️❌]\s*\*\*(.+?)\*\*\s*—\s*(.+)/);
      if (itemMatch) {
        if (current) sections.factChecks.push(current);
        const claim = itemMatch[1].trim();
        const rest = itemMatch[2].trim();
        const statusMatch = rest.match(/\*\*Status:\*\*\s*(.+)/i) || rest.match(/Status:\s*(.+)/i);
        let status = statusMatch ? statusMatch[1].trim() : rest;
        status = status.replace(/\*\*/g, '').trim();
        current = { claim, status };
      } else if (current && line.trim() && !line.match(/^[-•]\s/)) {
        // Continuation line
        current.status += ' ' + line.trim();
      }
    }
    if (current) sections.factChecks.push(current);
  }

  return sections;
}

function parseNextEpisode(content) {
  const topics = [];
  const lines = content.split('\n');
  let current = null;
  for (const line of lines) {
    const headerMatch = line.match(/^###\s+\d+\.\s*(.+)/);
    if (headerMatch) {
      if (current) topics.push(current);
      current = { title: headerMatch[1].trim(), body: '' };
    } else if (current && line.trim() && !line.match(/^##/)) {
      current.body += (current.body ? ' ' : '') + line.trim().replace(/^[-•]\s*/, '');
    }
  }
  if (current) topics.push(current);
  return topics;
}

function extractDescriptionParagraph(text) {
  // The Description.txt files have a narrative paragraph followed by structured sections
  // Return just the first paragraph (the narrative)
  const parts = text.split(/\n\n/);
  const firstPara = parts[0]?.trim() || '';
  // If first para is very short and second looks like narrative, combine
  if (firstPara.length < 100 && parts[1] && !parts[1].startsWith('Chapters:')) {
    return (firstPara + ' ' + parts[1]).trim();
  }
  return firstPara;
}

async function fetchEpisodes() {
  const res = await fetch(RSS_URL);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const raw = m[1];
    const title = extract('title', raw);
    const link = extract('link', raw);
    const pubDate = extract('pubDate', raw);
    const duration = extract('itunes:duration', raw);
    const summary = extract('itunes:summary', raw) || extract('description', raw);

    const description = truncate(stripTags(summary));

    items.push({
      number: parseInt(title.match(/Ep\s+(\d+)/)?.[1] || 0, 10),
      title: cleanTitle(title),
      fullTitle: title,
      date: pubDate,
      durationMinutes: parseDuration(duration),
      description,
      url: link,
    });
  }

  return items;
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

function renderDetailPage(ep, content) {
  const date = formatDate(ep.date);
  const meta = `Episode ${ep.number} · ${date}${ep.durationMinutes ? ' · ' + ep.durationMinutes + ' min' : ''}`;
  const ogDesc = truncate(stripTags(content.fullDescription || ep.description), 160);
  const ogImage = 'https://shoresofignorance.com/assets/soi-hero-banner.png';

  let quotesHtml = '';
  if (content.quotes && content.quotes.length > 0) {
    const quoteCards = content.quotes.map(q => {
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
  if (content.resources && content.resources.length > 0) {
    const resourceItems = content.resources.map(r => {
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
  if (content.factChecks && content.factChecks.length > 0) {
    const factItems = content.factChecks.map(f => {
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
  if (content.nextTopics && content.nextTopics.length > 0) {
    const topicItems = content.nextTopics.map(t =>
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
            <p>${htmlEscape(content.fullDescription || ep.description)}</p>
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

async function main() {
  console.log('Fetching RSS feed...');
  const episodes = await fetchEpisodes();
  if (episodes.length === 0) throw new Error('No episodes found in RSS feed');

  const latest = episodes[0];
  const recent = episodes.slice(0, 6);

  // Update index.html
  let html = await readFile(INDEX_PATH, 'utf8');

  // Update hero latest episode info
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
    html = html.replace(
      /(<a href="[^"]*" class="btn btn-primary" id="latest-play")/,
      `$1 target="_blank" rel="noopener"`
    );
  }

  // Update episode list
  const cardsHtml = recent.map(renderCard).join('\n');
  html = html.replace(
    /<!-- EPISODES_START -->[\s\S]*?<!-- EPISODES_END -->/,
    `<!-- EPISODES_START -->\n${cardsHtml}\n        <!-- EPISODES_END -->`
  );

  // Remove stale comment if present
  html = html.replace(/\s*<!-- Episodes rendered from episodes\.json -->/, '');

  await writeFile(INDEX_PATH, html, 'utf8');
  console.log(`Updated ${INDEX_PATH} with ${episodes.length} episodes (${recent.length} shown).`);

  // Generate episode detail pages
  console.log('Generating episode detail pages...');
  for (const ep of episodes) {
    if (ep.number === 0) {
      console.log(`  → skipping episode with no number: ${ep.fullTitle}`);
      continue;
    }
    const files = await findContentFiles(ep.number);
    const content = {
      fullDescription: ep.description,
      quotes: [],
      resources: [],
      factChecks: [],
      nextTopics: [],
    };

    // Read full description if available
    if (files.description) {
      const desc = await readFile(files.description, 'utf8');
      content.fullDescription = extractDescriptionParagraph(desc);
    }

    // Read key quotes
    if (files.keyQuotes) {
      const qContent = await readFile(files.keyQuotes, 'utf8');
      content.quotes = parseKeyQuotes(qContent);
    }

    // Read show notes for resources and fact checks
    if (files.showNotes) {
      const snContent = await readFile(files.showNotes, 'utf8');
      const parsed = parseShowNotes(snContent);
      content.resources = parsed.resources;
      content.factChecks = parsed.factChecks;
    }

    // Read next episode threads
    if (files.nextEpisode) {
      const neContent = await readFile(files.nextEpisode, 'utf8');
      content.nextTopics = parseNextEpisode(neContent);
    }

    const epDir = join(EPISODES_DIR, String(ep.number));
    await mkdir(epDir, { recursive: true });
    const detailHtml = renderDetailPage(ep, content);
    await writeFile(join(epDir, 'index.html'), detailHtml, 'utf8');
    console.log(`  → episodes/${ep.number}/index.html`);
  }

  console.log(`Generated ${episodes.length} episode detail pages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
