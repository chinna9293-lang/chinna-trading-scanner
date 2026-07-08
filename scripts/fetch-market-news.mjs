// Fetches today's top stock market / finance headlines from Google News RSS.
// No API key required — Google News RSS is free and public.

const FEED_URL =
  'https://news.google.com/rss/search?q=stock%20market%20OR%20wall%20street%20OR%20nasdaq%20when:1d&hl=en-US&gl=US&ceid=US:en';

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .trim();
}

function parseItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    const title = decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pubDate = decodeEntities((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const source = decodeEntities((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');

    if (title) items.push({ title, link, pubDate, source });
  }

  return items;
}

// Google News titles are usually formatted "Headline - Source"; split those apart
// when the <source> tag itself was empty.
function splitTitleSource(item) {
  if (item.source) return item;
  const m = item.title.match(/^(.*)\s+-\s+([^-]+)$/);
  if (m) return { ...item, title: m[1].trim(), source: m[2].trim() };
  return item;
}

export async function fetchMarketNews(limit = 5) {
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChinnaTradingScanner/1.0)' },
  });

  if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`);

  const xml = await res.text();
  const items = parseItems(xml).map(splitTitleSource);

  // De-dupe near-identical headlines (Google News often has repeats across sources)
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, limit);
}

// Allow running directly: node scripts/fetch-market-news.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchMarketNews().then((news) => console.log(JSON.stringify(news, null, 2)));
}
