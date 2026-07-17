#!/usr/bin/env node
/**
 * sync-episodes.mjs
 *
 * Fetches the SoundCloud RSS feed, finds matching content files in the
 * local podcast directory, parses show notes / key quotes / next episode
 * threads, and writes/updates episodes.json.
 *
 * Run locally (not in Cloudflare Pages build):
 *   npm run sync
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:500028120/sounds.rss';
const PODCAST_DIR = '/Users/gk/.openclaw/workspace/podcast';
const EPISODES_JSON = './episodes.json';

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
    if (!f.startsWith(prefix)) continue;
    if (f.endsWith('_Show_Notes.md')) result.showNotes = join(PODCAST_DIR, f);
    else if (f.endsWith('_Key_Quotes.md')) result.keyQuotes = join(PODCAST_DIR, f);
    else if (f.endsWith('_Description.txt')) result.description = join(PODCAST_DIR, f);
    else if (f.endsWith('_Next_Episode.md')) result.nextEpisode = join(PODCAST_DIR, f);
    else if (f.endsWith('_Transcript.txt')) result.transcript = join(PODCAST_DIR, f);
    else if (f.endsWith('_notes.md') && !result.showNotes) result.showNotes = join(PODCAST_DIR, f);
    else if (f.endsWith('.txt') && !f.includes('_') && !result.description) result.description = join(PODCAST_DIR, f);
  }
  return result;
}

function extractDescriptionParagraph(text) {
  const parts = text.split(/\n\n/);
  const firstPara = parts[0]?.trim() || '';
  if (firstPara.length < 100 && parts[1] && !parts[1].startsWith('Chapters:')) {
    return (firstPara + ' ' + parts[1]).trim();
  }
  return firstPara;
}

function parseKeyQuotes(content) {
  const quotes = [];
  const blocks = content.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    const contentLines = lines.filter(l => !l.match(/^#+\s/) && !l.match(/^\*\*Key Quotes/i) && !l.match(/^\*Generated:/));
    if (contentLines.length < 2) continue;

    let quoteLine = contentLines.find(l => l.match(/^\*\*Quote \d*:\*\*\s*"/));
    if (!quoteLine) {
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
    text = text.replace(/^\*\*"/, '"').replace(/"\*\*$/, '"');
    text = text.replace(/\*\*/g, '').replace(/\*(?!\s)/g, '');

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
  const sections = { resources: [], factChecks: [] };

  const resourcesMatch = content.match(/##\s*Resources?[\s\S]*?(?=\n##\s|\n##\s*$|$)/i);
  if (resourcesMatch) {
    const block = resourcesMatch[0];
    const items = block.split(/^[-•]\s*/m).slice(1);
    for (const item of items) {
      const lines = item.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const titleMatch = lines[0].match(/^\*\*(.+?)\*\*(?:\s*—\s*|\s*-\s*|\s*)?(.*)$/);
      if (!titleMatch) continue;

      let title = titleMatch[1].trim().replace(/\*+/g, '').trim();
      // Strip markdown link syntax from titles: [*Title*](url) or [Title](url)
      title = title.replace(/\[(.*?)\]\([^)]+\)/g, '$1').trim();
      let description = titleMatch[2].trim();
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^###\s/)) continue;
        description += (description ? ' ' : '') + line;
      }

      // Extract URL from description (including from markdown link syntax)
      const mdUrlMatch = description.match(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/);
      const plainUrlMatch = description.match(/(https?:\/\/[^\s)]+)/);
      const url = mdUrlMatch ? mdUrlMatch[2] : (plainUrlMatch ? plainUrlMatch[1] : '');
      // Strip markdown links and plain URLs from description
      description = description.replace(/\[[^\]]*\]\([^)]+\)/g, '');
      description = description.replace(/https?:\/\/[^\s)]+/g, '');
      description = description.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
      // Clean up leading punctuation artifacts (em-dash, hyphen, semicolon, colon)
      description = description.replace(/^[-—;:\s]+/, '').trim();

      sections.resources.push({ title, description, url });
    }
  }

  const factMatch = content.match(/##\s*Fact Checks?[\s\S]*?(?=\n##\s|\n##\s*$|$)/i);
  if (factMatch) {
    const block = factMatch[0];
    const lines = block.split('\n');
    let current = null;
    for (const line of lines) {
      if (line.match(/^##\s/)) continue;
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
  let inOpenQuestions = false;
  for (const line of lines) {
    // Stop parsing at "## Open Questions" or "## Open Threads"
    if (line.match(/^##\s*Open\s+(Questions|Threads)/i)) {
      inOpenQuestions = true;
      continue;
    }
    if (inOpenQuestions) continue;

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

    items.push({
      number: parseInt(title.match(/Ep\s+(\d+)/)?.[1] || 0, 10),
      title: cleanTitle(title),
      fullTitle: title,
      date: pubDate,
      durationMinutes: parseDuration(duration),
      description: truncate(stripTags(summary)),
      url: link,
    });
  }

  return items;
}

async function main() {
  console.log('Fetching RSS feed...');
  const rssEpisodes = await fetchEpisodes();
  console.log(`Found ${rssEpisodes.length} episodes in RSS feed.`);

  let existing = [];
  try {
    const raw = await readFile(EPISODES_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    existing = Array.isArray(parsed) ? parsed : Object.values(parsed);
  } catch {
    existing = [];
  }

  const existingMap = new Map(existing.map(e => [e.number, e]));
  const updated = [];
  let changedCount = 0;
  let newCount = 0;

  for (const ep of rssEpisodes) {
    if (ep.number === 0) {
      console.log(`  → skipping episode with no number: ${ep.fullTitle}`);
      continue;
    }

    const prev = existingMap.get(ep.number);
    const files = await findContentFiles(ep.number);

    const content = {
      fullDescription: ep.description,
      quotes: [],
      resources: [],
      factChecks: [],
      nextTopics: [],
    };

    if (files.description) {
      const desc = await readFile(files.description, 'utf8');
      content.fullDescription = extractDescriptionParagraph(desc);
    }

    if (files.keyQuotes) {
      const qContent = await readFile(files.keyQuotes, 'utf8');
      content.quotes = parseKeyQuotes(qContent);
    }

    if (files.showNotes) {
      const snContent = await readFile(files.showNotes, 'utf8');
      const parsed = parseShowNotes(snContent);
      content.resources = parsed.resources;
      content.factChecks = parsed.factChecks;
    }

    if (files.nextEpisode) {
      const neContent = await readFile(files.nextEpisode, 'utf8');
      content.nextTopics = parseNextEpisode(neContent);
    }

    // Filter out "Open Questions" from future threads
    content.nextTopics = content.nextTopics.filter(
      t => !t.title.toLowerCase().includes('open question')
    );

    const entry = {
      number: ep.number,
      title: ep.title,
      date: ep.date,
      durationMinutes: ep.durationMinutes,
      description: ep.description,
      url: ep.url,
      fullDescription: content.fullDescription,
      keyQuotes: content.quotes,
      resources: content.resources,
      factChecks: content.factChecks,
      futureThreads: content.nextTopics,
      updatedAt: new Date().toISOString(),
    };

    if (!prev) {
      newCount++;
      console.log(`  → new episode ${ep.number}: ${ep.title}`);
    } else {
      // Check if content changed meaningfully
      const prevStr = JSON.stringify({
        title: prev.title,
        date: prev.date,
        durationMinutes: prev.durationMinutes,
        description: prev.description,
        url: prev.url,
        fullDescription: prev.fullDescription,
        keyQuotes: prev.keyQuotes,
        resources: prev.resources,
        factChecks: prev.factChecks,
        futureThreads: prev.futureThreads,
      });
      const currStr = JSON.stringify({
        title: entry.title,
        date: entry.date,
        durationMinutes: entry.durationMinutes,
        description: entry.description,
        url: entry.url,
        fullDescription: entry.fullDescription,
        keyQuotes: entry.keyQuotes,
        resources: entry.resources,
        factChecks: entry.factChecks,
        futureThreads: entry.futureThreads,
      });
      if (prevStr !== currStr) {
        changedCount++;
        console.log(`  → updated episode ${ep.number}: ${ep.title}`);
      } else {
        // Preserve previous updatedAt if nothing changed
        entry.updatedAt = prev.updatedAt;
        console.log(`  → unchanged episode ${ep.number}: ${ep.title}`);
      }
    }

    updated.push(entry);
  }

  // Sort by episode number ascending
  updated.sort((a, b) => a.number - b.number);

  await writeFile(EPISODES_JSON, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`\nWrote ${updated.length} episodes to ${EPISODES_JSON}`);
  console.log(`  New: ${newCount}, Updated: ${changedCount}, Unchanged: ${updated.length - newCount - changedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
