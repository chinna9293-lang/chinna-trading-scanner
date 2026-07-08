// Publishes docs/instagram/latest.png to Instagram via the Graph API.
//
// Requires (as env vars / GitHub Secrets):
//   IG_USER_ID     - Instagram Business/Creator account ID
//   IG_ACCESS_TOKEN - Long-lived Page access token with instagram_content_publish scope
//
// The image must already be live at its public GitHub Pages URL before this runs
// (see .github/workflows/news-instagram.yml, which pushes + waits before calling this).
//
// See INSTAGRAM_SETUP.md for how to obtain IG_USER_ID / IG_ACCESS_TOKEN.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const GRAPH_VERSION = 'v21.0';
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || 'https://chinna9293-lang.github.io/chinna-trading-scanner';
const IMAGE_URL = `${PUBLIC_BASE_URL}/instagram/latest.png?t=${Date.now()}`;
const CAPTION_PATH = path.join(process.cwd(), 'docs', 'instagram', 'latest-caption.txt');

async function waitForImageLive(url, { retries = 10, delayMs = 6000 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
      console.log(`Image not live yet (HTTP ${res.status}), retry ${i + 1}/${retries}...`);
    } catch (e) {
      console.log(`Image check failed (${e.message}), retry ${i + 1}/${retries}...`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function graphPost(pathSegment, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pathSegment}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Graph API error at ${pathSegment}: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function postToInstagram() {
  const IG_USER_ID = process.env.IG_USER_ID;
  const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    throw new Error('Missing IG_USER_ID or IG_ACCESS_TOKEN env vars — see INSTAGRAM_SETUP.md');
  }

  const live = await waitForImageLive(IMAGE_URL.split('?')[0]);
  if (!live) throw new Error('Image never became publicly reachable on GitHub Pages — aborting post');

  const caption = await readFile(CAPTION_PATH, 'utf-8').catch(() => 'Market news update');

  console.log('Creating media container...');
  const container = await graphPost(`${IG_USER_ID}/media`, {
    image_url: IMAGE_URL,
    caption,
    access_token: IG_ACCESS_TOKEN,
  });

  console.log(`Container created: ${container.id}. Publishing...`);
  const published = await graphPost(`${IG_USER_ID}/media_publish`, {
    creation_id: container.id,
    access_token: IG_ACCESS_TOKEN,
  });

  console.log(`Published to Instagram: media id ${published.id}`);
  return published;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  postToInstagram().catch((e) => {
    console.error('post-to-instagram failed:', e.message);
    process.exit(1);
  });
}
