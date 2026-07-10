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

const MARGIN = 48;
const TOP_BAR = 10;
const HEADER_HEIGHT = 140;
const FOOTER_HEIGHT = 64;
const FONT_SIZE = 28;
const LINE_HEIGHT = 36;
const CARD_PAD_Y = 18;
const CARD_GAP = 14;
const TEXT_INDENT = 74;
const CARD_LEFT_PAD = 26;

function layoutHeadlines(headlines) {
  const contentWidth = WIDTH - MARGIN * 2 - TEXT_INDENT - CARD_LEFT_PAD;
  let y = TOP_BAR + HEADER_HEIGHT;
  const items = [];

  for (const title of headlines) {
    const lines = wrapText(title, FONT_SIZE, contentWidth);
    const cardHeight = lines.length * LINE_HEIGHT + CARD_PAD_Y * 2 - 8;
    items.push({ title, lines, y, cardHeight });
    y += cardHeight + CARD_GAP;
  }

  return { items, totalHeight: y - CARD_GAP + FOOTER_HEIGHT };
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

function headerMark() {
  // A small ascending bar-chart mark instead of a plain squiggle.
  const bars = [
    { x: MARGIN, h: 20 },
    { x: MARGIN + 14, h: 32 },
    { x: MARGIN + 28, h: 26 },
    { x: MARGIN + 42, h: 44 },
  ];
  const base = TOP_BAR + 84;
  return bars
    .map(
      (b) =>
        `<rect x="${b.x}" y="${base - b.h}" width="9" height="${b.h}" rx="2.5" fill="url(#markGrad)" />`
    )
    .join('\n    ');
}

function buildSvg(items, dateLabel, height) {
  const cards = items
    .map(({ lines, y, cardHeight }, i) => {
      const textStartY = y + CARD_PAD_Y + FONT_SIZE - 6;
      const badgeCy = y + cardHeight / 2;

      const lineEls = lines
        .map(
          (line, li) =>
            `<text x="${MARGIN + TEXT_INDENT}" y="${textStartY + li * LINE_HEIGHT}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="600" fill="#f4f4f5">${escapeXml(line)}</text>`
        )
        .join('\n        ');

      return `
      <g filter="url(#cardShadow)">
        <rect x="${MARGIN}" y="${y}" width="${WIDTH - MARGIN * 2}" height="${cardHeight}" rx="16" fill="url(#cardGrad)" stroke="#2c2c31" stroke-width="1" />
      </g>
      <rect x="${MARGIN}" y="${y}" width="4" height="${cardHeight}" rx="2" fill="url(#markGrad)" />
      <rect x="${MARGIN + CARD_LEFT_PAD}" y="${badgeCy - 18}" width="36" height="36" rx="10" fill="url(#badgeGrad)" filter="url(#badgeShadow)" />
      <text x="${MARGIN + CARD_LEFT_PAD + 18}" y="${badgeCy + 7}" font-family="${FONT}" font-size="19" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>
      ${lineEls}
      `;
    })
    .join('\n');

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#131316" />
      <stop offset="100%" stop-color="#0a0a0c" />
    </linearGradient>
    <linearGradient id="topBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#dc2626" />
      <stop offset="55%" stop-color="#f97316" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
    <linearGradient id="markGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#b91c1c" />
      <stop offset="100%" stop-color="#f97316" />
    </linearGradient>
    <linearGradient id="badgeGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ef4444" />
      <stop offset="100%" stop-color="#b91c1c" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1d1d21" />
      <stop offset="100%" stop-color="#17171a" />
    </linearGradient>
    <radialGradient id="glow" cx="85%" cy="0%" r="60%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#dc2626" stop-opacity="0" />
    </radialGradient>
    <filter id="cardShadow" x="-20%" y="-40%" width="140%" height="200%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.4" />
    </filter>
    <filter id="badgeShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#dc2626" flood-opacity="0.45" />
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${height}" fill="url(#bg)" />
  <rect width="${WIDTH}" height="${height}" fill="url(#glow)" />
  <rect x="0" y="0" width="${WIDTH}" height="${TOP_BAR}" fill="url(#topBar)" />

  ${headerMark()}
  <text x="${MARGIN + 66}" y="${TOP_BAR + 66}" font-family="${FONT}" font-size="44" font-weight="800" fill="#ffffff" letter-spacing="0.5">WORLD NEWS</text>
  <text x="${MARGIN + 66}" y="${TOP_BAR + 100}" font-family="${FONT}" font-size="21" fill="#9ca3af">${escapeXml(dateLabel)}</text>

  <rect x="${WIDTH - MARGIN - 118}" y="${TOP_BAR + 34}" width="118" height="34" rx="17" fill="none" stroke="#3f3f46" stroke-width="1.5" />
  <circle cx="${WIDTH - MARGIN - 96}" cy="${TOP_BAR + 51}" r="5" fill="#f97316" />
  <text x="${WIDTH - MARGIN - 82}" y="${TOP_BAR + 56}" font-family="${FONT}" font-size="16" font-weight="700" fill="#e4e4e7" letter-spacing="1">TOP ${items.length}</text>

  ${cards}

  <text x="${MARGIN}" y="${height - 24}" font-family="${FONT}" font-size="18" fill="#52525b">chinna-trading-scanner</text>
  <text x="${WIDTH - MARGIN}" y="${height - 24}" font-family="${FONT}" font-size="18" fill="#52525b" text-anchor="end">Headlines only · no third-party media</text>
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
