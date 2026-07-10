// One-off/standalone: renders a list of world headlines (title only, no source
// attribution or links) into a 1080x1080 Instagram-ready image.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SIZE = 1080;
const FONT = 'DejaVu Sans, Arial, sans-serif';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function buildSvg(headlines, dateLabel) {
  const margin = 64;
  const contentWidth = SIZE - margin * 2;
  const fontSize = 28;
  const lineHeight = 34;
  const gapBetween = 20;
  let y = 168;

  const blocks = headlines
    .map((title, i) => {
      const lines = wrapText(title, fontSize, contentWidth - 66, 2);
      const badgeY = y;
      const textStartY = y + 10;

      const lineEls = lines
        .map((line, li) => `<text x="${margin + 66}" y="${textStartY + li * lineHeight}" font-family="${FONT}" font-size="${fontSize}" font-weight="600" fill="#f8fafc">${escapeXml(line)}</text>`)
        .join('\n        ');

      const blockHeight = lines.length * lineHeight + gapBetween;
      y += blockHeight;

      return `
        <circle cx="${margin + 24}" cy="${badgeY + 14}" r="20" fill="#dc2626" />
        <text x="${margin + 24}" y="${badgeY + 21}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>
        ${lineEls}
      `;
    })
    .join('\n');

  return `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0f10" />
      <stop offset="100%" stop-color="#1a1a1c" />
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)" />

  <polyline points="${margin},96 ${margin + 18},78 ${margin + 34},90 ${margin + 54},58 ${margin + 70},70" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
  <text x="${margin + 92}" y="98" font-family="${FONT}" font-size="46" font-weight="800" fill="#ffffff">WORLD NEWS</text>
  <text x="${margin}" y="138" font-family="${FONT}" font-size="24" fill="#94a3b8">${escapeXml(dateLabel)} · Top ${headlines.length} Headlines</text>
  <line x1="${margin}" y1="152" x2="${SIZE - margin}" y2="152" stroke="#27272a" stroke-width="2" />

  ${blocks}

  <line x1="${margin}" y1="${SIZE - 60}" x2="${SIZE - margin}" y2="${SIZE - 60}" stroke="#27272a" stroke-width="2" />
  <text x="${margin}" y="${SIZE - 26}" font-family="${FONT}" font-size="20" fill="#52525b">chinna-trading-scanner</text>
</svg>`;
}

export async function generateWorldHeadlinesImage(headlines, outPath) {
  if (!headlines || headlines.length === 0) throw new Error('No headlines provided');

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

  const svg = buildSvg(headlines, dateLabel);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, png);
  console.log(`Generated -> ${outPath}`);
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
