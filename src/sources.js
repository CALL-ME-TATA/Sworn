// Wikipedia search and page text, plus the quote check used by agents, trials and the baseline.
import 'dotenv/config';
import fs from 'node:fs';

// Wikimedia asks API clients to name a contact (email or URL) in the User-Agent; set WIKI_CONTACT in .env.
const UA = { 'User-Agent': `trusted-agent-hiring/0.1 (VVCE Hack Day demo; ${process.env.WIKI_CONTACT || 'contact not set'})` };
const REST = 'https://en.wikipedia.org';

// Disk cache shared by the agent server and the orchestrator, so trials and re-runs don't hit Wikipedia again.
// ponytail: one JSON file, last writer wins between processes; fine for a demo, use a real store if it grows.
const CACHE_FILE = new URL('../data/wiki-cache.json', import.meta.url);
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
const remember = (key, value) => {
  cache[key] = value;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return value;
};

export const wikiUrl = title => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

// At most one Wikipedia request per 200 ms from this process, as Wikimedia's API etiquette asks for.
let nextSlot = 0;
const paced = async () => {
  const wait = nextSlot - Date.now();
  nextSlot = Math.max(nextSlot, Date.now()) + 200;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
};

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    await paced();
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      await new Promise(r => setTimeout(r, Math.min(wait, 10000)));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res;
  }
}

// REST endpoints (CDN-cached) instead of action=query&prop=extracts, which Wikimedia throttles hard.
export async function searchWikipedia(query, limit = 2) {
  const key = `search:${limit}:${query}`;
  if (cache[key]) return cache[key];
  const j = await (await get(`${REST}/w/rest.php/v1/search/page?limit=${limit}&q=${encodeURIComponent(query)}`)).json();
  return remember(key, j.pages.map(p => p.title));
}

export async function wikiText(title) {
  const key = `html:${title}`;
  if (cache[key] !== undefined) return cache[key];
  const html = await (await get(`${REST}/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, '_'))}`)).text();
  return remember(key, htmlToText(html));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g; // attribute values can contain '>' (Parsoid's data-mw JSON)

// Article prose only: the text of <p> elements, so infoboxes, captions and navboxes never become "facts".
export function htmlToText(html) {
  const paragraphs = html.match(/<p[\s>][\s\S]*?<\/p>/gi) ?? [];
  return paragraphs
    .map(p => p
      .replace(/<sup(?:[^>"']|"[^"]*"|'[^']*')*class="[^"]*reference[\s\S]*?<\/sup>/gi, '') // [1]-style markers
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(TAG, '')
      .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, n) => String.fromCodePoint(parseInt(n, hex ? 16 : 10)))
      .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n');
}

// Plain text of any source URL; Wikipedia pages go through the API so quotes match the text agents saw.
export async function sourceText(url) {
  const wiki = url.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/);
  if (wiki) return wikiText(decodeURIComponent(wiki[1]).replace(/_/g, ' '));
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).replace(/<[^>]+>/g, ' ');
}

export const normalize = s => String(s)
  .toLowerCase()
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

// A quote counts only if it is at least 10 characters and appears in the source text.
export const quoteIn = (text, quote) =>
  typeof quote === 'string' && normalize(quote).length >= 10 && normalize(text).includes(normalize(quote));
