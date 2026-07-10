// One-off/standalone: renders a list of world headlines (title only, no source
// attribution or links) into an Instagram-ready image. Headlines wrap in full —
// never truncated with an ellipsis — and the headline count is auto-trimmed to
// whatever fits cleanly within Instagram's max portrait height (1080x1350).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const WIDTH = 1080;
const MAX_HEIGHT = 1350; // Instagram's tallest supported ratio (4:5)
const FONT = 'DejaVu Sans, Arial, sans-serif';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Wraps to as many lines as needed — no line cap, no ellipsis truncation.
function wrapText(text, fontSize, maxWidth) {
  const maxChars = Math.floor(maxWidth / (fontSize * 0.55));
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines;
}

const MARGIN = 64;
const HEADER_HEIGHT = 168;
const FOOTER_HEIGHT = 88;
const FONT_SIZE = 30;
const LINE_HEIGHT = 40;
const GAP_BETWEEN = 34;
const TEXT_INDENT = 66;

function layoutHeadlines(headlines) {
  const contentWidth = WIDTH - MARGIN * 2 - TEXT_INDENT;
  let y = HEADER_HEIGHT;
  const items = [];

  for (const title of headlines) {
    const lines = wrapText(title, FONT_SIZE, contentWidth);
    const blockHeight = lines.length * LINE_HEIGHT + GAP_BETWEEN;
    items.push({ title, lines, y });
    y += blockHeight;
  }

  return { items, totalHeight: y + FOOTER_HEIGHT };
}

// Trims from the end until the block fits inside MAX_HEIGHT, so every
// remaining headline gets to wrap in full instead of being cut off.
function fitHeadlines(headlines) {
  let pool = headlines.slice();
  let layout = layoutHeadlines(pool);

  while (layout.totalHeight > MAX_HEIGHT && pool.length > 1) {
    pool = pool.slice(0, -1);
    layout = layoutHeadlines(pool);
  }

  return { pool, layout };
}

function buildSvg(items, dateLabel, height) {
  const blocks = items
    .map(({ lines }, i) => {
      const badgeY = items[i].y;
      const textStartY = badgeY + 12;

      const lineEls = lines
        .map((line, li) => `<text x="${MARGIN + TEXT_INDENT}" y="${textStartY + li * LINE_HEIGHT}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="600" fill="#f8fafc">${escapeXml(line)}</text>`)
        .join('\n        ');

      return `
        <circle cx="${MARGIN + 24}" cy="${badgeY + 16}" r="20" fill="#dc2626" />
        <text x="${MARGIN + 24}" y="${badgeY + 23}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>
        ${lineEls}
      `;
    })
    .join('\n');

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0f10" />
      <stop offset="100%" stop-color="#1a1a1c" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="url(#bg)" />

  <polyline points="${MARGIN},96 ${MARGIN + 18},78 ${MARGIN + 34},90 ${MARGIN + 54},58 ${MARGIN + 70},70" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
  <text x="${MARGIN + 92}" y="98" font-family="${FONT}" font-size="46" font-weight="800" fill="#ffffff">WORLD NEWS</text>
  <text x="${MARGIN}" y="138" font-family="${FONT}" font-size="24" fill="#94a3b8">${escapeXml(dateLabel)} · Top ${items.length} Headlines</text>
  <line x1="${MARGIN}" y1="152" x2="${WIDTH - MARGIN}" y2="152" stroke="#27272a" stroke-width="2" />

  ${blocks}

  <line x1="${MARGIN}" y1="${height - 60}" x2="${WIDTH - MARGIN}" y2="${height - 60}" stroke="#27272a" stroke-width="2" />
  <text x="${MARGIN}" y="${height - 26}" font-family="${FONT}" font-size="20" fill="#52525b">chinna-trading-scanner</text>
</svg>`;
}

export async function generateWorldHeadlinesImage(headlines, outPath) {
  if (!headlines || headlines.length === 0) throw new Error('No headlines provided');

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

  const { pool, layout } = fitHeadlines(headlines);
  const height = Math.min(MAX_HEIGHT, Math.max(WIDTH, layout.totalHeight));

  if (pool.length < headlines.length) {
    console.log(`Trimmed ${headlines.length - pool.length} headline(s) to keep full, untruncated wrapping within ${MAX_HEIGHT}px`);
  }

  const svg = buildSvg(layout.items, dateLabel, height);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, png);
  console.log(`Generated -> ${outPath} (${pool.length} headlines, ${WIDTH}x${height})`);
  return outPath;
}

const HEADLINES = [
  "Iran Live Updates: Trump Suggests Cease-Fire Is 'Over' After Latest Strikes",
  "Sabre-rattling to 'tremendous love': erratic Trump dominates final hours of NATO summit",
  "In shift, Trump praises Zelensky, will let Ukraine build Patriot missiles",
  "UK: Farage's election gamble could see him face one challenger — Count Binface",
  "Russia deploys $1.5M Starlink jammers, Ukraine uses their flaw to strike back",
  "After losing to the Mail, Prince Harry seems doomed to a sad life in California",
  "Frantic search underway for crew after Boeing 737 wreckage found by officials",
  "Russians are growing anxious and angry",
  "German doctor jailed for murder of 15 patients and suspected of more",
  "Ukrainian drones hammer Russia's Saratov oil refinery, Tatarstan petrochemical plant, Zelensky confirms",
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = process.argv[2] || path.join(process.cwd(), 'docs', 'instagram', 'world-headlines.png');
  generateWorldHeadlinesImage(HEADLINES, outPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
