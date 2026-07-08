// Renders today's market headlines into a 1080x1080 Instagram-ready image.
// Pipeline: fetch headlines -> build SVG -> rasterize with sharp -> write PNG.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fetchMarketNews } from './fetch-market-news.mjs';

const SIZE = 1080;
const OUT_DIR = path.join(process.cwd(), 'docs', 'instagram');
const FONT = 'DejaVu Sans, Arial, sans-serif';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Rough word-wrap for a variable-width font: estimate ~0.55*fontSize px per char.
function wrapText(text, fontSize, maxWidth, maxLines) {
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
    if (lines.length === maxLines - 1) break;
  }
  if (current) lines.push(current);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1).trimEnd() + '…';
    else last += '…';
    lines[maxLines - 1] = last;
  }

  return lines.slice(0, maxLines);
}

function buildSvg(headlines, dateLabel, timeLabel) {
  const margin = 70;
  const contentWidth = SIZE - margin * 2;
  let y = 210;

  const headlineBlocks = headlines
    .map((item, i) => {
      const lines = wrapText(item.title, 34, contentWidth - 90, 2);
      const badgeY = y;
      const textStartY = y + 12;

      const lineEls = lines
        .map((line, li) => `<text x="${margin + 90}" y="${textStartY + li * 42}" font-family="${FONT}" font-size="34" font-weight="600" fill="#f1f5f9">${escapeXml(line)}</text>`)
        .join('\n        ');

      const sourceY = textStartY + lines.length * 42 + 6;
      const sourceEl = item.source
        ? `<text x="${margin + 90}" y="${sourceY}" font-family="${FONT}" font-size="22" fill="#38bdf8">${escapeXml(item.source.toUpperCase())}</text>`
        : '';

      const blockHeight = lines.length * 42 + (item.source ? 44 : 20) + 30;
      y += blockHeight;

      return `
        <circle cx="${margin + 34}" cy="${badgeY + 20}" r="26" fill="#1d4ed8" />
        <text x="${margin + 34}" y="${badgeY + 29}" font-family="${FONT}" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>
        ${lineEls}
        ${sourceEl}
      `;
    })
    .join('\n');

  return `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1120" />
      <stop offset="100%" stop-color="#111827" />
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)" />

  <polyline points="${margin},98 ${margin + 18},80 ${margin + 34},92 ${margin + 54},60 ${margin + 70},72" fill="none" stroke="#22c55e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
  <polygon points="${margin + 70},72 ${margin + 68},58 ${margin + 54},64" fill="#22c55e" />
  <text x="${margin + 92}" y="100" font-family="${FONT}" font-size="52" font-weight="800" fill="#ffffff">MARKET NEWS</text>
  <text x="${margin}" y="145" font-family="${FONT}" font-size="28" fill="#94a3b8">${escapeXml(dateLabel)} · ${escapeXml(timeLabel)} Update</text>
  <line x1="${margin}" y1="170" x2="${SIZE - margin}" y2="170" stroke="#1e293b" stroke-width="2" />

  ${headlineBlocks}

  <line x1="${margin}" y1="${SIZE - 90}" x2="${SIZE - margin}" y2="${SIZE - 90}" stroke="#1e293b" stroke-width="2" />
  <text x="${margin}" y="${SIZE - 50}" font-family="${FONT}" font-size="24" fill="#64748b">chinna-trading-scanner</text>
  <text x="${SIZE - margin}" y="${SIZE - 50}" font-family="${FONT}" font-size="24" fill="#64748b" text-anchor="end">#StockMarket #Trading #Finance</text>
</svg>`;
}

export async function generateNewsImage() {
  const headlines = await fetchMarketNews(5);
  if (headlines.length === 0) throw new Error('No headlines fetched — aborting image generation');

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
  const timeLabel = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const svg = buildSvg(headlines, dateLabel, timeLabel);

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(path.join(OUT_DIR, 'archive'), { recursive: true });

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  const latestPath = path.join(OUT_DIR, 'latest.png');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(OUT_DIR, 'archive', `${stamp}.png`);

  await writeFile(latestPath, png);
  await writeFile(archivePath, png);

  const caption = [
    `📈 Market News Update — ${dateLabel}`,
    '',
    ...headlines.map((h, i) => `${i + 1}. ${h.title}${h.source ? ` (${h.source})` : ''}`),
    '',
    '#StockMarket #Trading #Investing #WallStreet #Finance #Nasdaq #StockNews',
  ].join('\n');

  await writeFile(path.join(OUT_DIR, 'latest.json'), JSON.stringify({ generatedAt: now.toISOString(), headlines, caption }, null, 2));
  await writeFile(path.join(OUT_DIR, 'latest-caption.txt'), caption);

  console.log(`Generated image with ${headlines.length} headlines -> ${latestPath}`);
  return { latestPath, archivePath, caption, headlines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateNewsImage().catch((e) => {
    console.error('generate-news-image failed:', e);
    process.exit(1);
  });
}
