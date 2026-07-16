#!/usr/bin/env node
/**
 * Build script for shoresofignorance.com
 *
 * Fetches the SoundCloud RSS feed and bakes the latest episodes into
 * index.html as static markup. The RSS feed is the single source of truth.
 */

import { readFile, writeFile } from 'node:fs/promises';

const RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:500028120/sounds.rss';
const INDEX_PATH = './index.html';

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
  const buttonText = ep.url ? 'Listen' : 'Soon';
  const target = ep.url ? ' target="_blank" rel="noopener"' : '';

  return `        <article class="episode-card">
          <div class="episode-number">${ep.number}</div>
          <div class="episode-info">
            <h3>${htmlEscape(ep.title)}</h3>
            <p>${htmlEscape(ep.description)}</p>
            <span class="meta">${htmlEscape(meta)}</span>
          </div>
          <a href="${htmlEscape(ep.url || '#')}" class="btn btn-ghost"${target}>${buttonText}</a>
        </article>`;
}

async function main() {
  console.log('Fetching RSS feed...');
  const episodes = await fetchEpisodes();
  if (episodes.length === 0) throw new Error('No episodes found in RSS feed');

  const latest = episodes[0];
  const recent = episodes.slice(0, 6);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
