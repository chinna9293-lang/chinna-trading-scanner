# Instagram Auto-Posting Setup

Every 4 hours, `.github/workflows/news-instagram.yml` fetches today's top market
headlines, renders them into an image (`docs/instagram/latest.png`), pushes it
to GitHub Pages, and publishes it to Instagram via the Graph API.

The code is already in place. What's left is a one-time setup in Meta's
developer console to get two secrets: `IG_USER_ID` and `IG_ACCESS_TOKEN`.

## Requirements

- An **Instagram account** converted to a **Business** or **Creator** account
  (Settings → Account type in the Instagram app).
- That Instagram account **linked to a Facebook Page** (can be a new, minimal
  Page — required by Meta even if you never post to it).

## Steps

1. **Create a Meta App**
   - Go to https://developers.facebook.com/apps → "Create App" → type "Other" →
     "Business".
   - Add the **Instagram Graph API** product to the app.

2. **Link your Instagram account**
   - In the app dashboard, under Instagram Graph API setup, connect the
     Facebook Page that's linked to your Instagram Business account.

3. **Get a User/Page access token with the right permissions**
   - In [Graph API Explorer](https://developers.facebook.com/tools/explorer/),
     select your app, then "Get Token" → "Get User Access Token".
   - Request these scopes: `instagram_basic`, `instagram_content_publish`,
     `pages_show_list`, `pages_read_engagement`.
   - This short-lived token needs to be exchanged for a **long-lived Page
     access token** (valid ~60 days, needs periodic refresh):
     ```bash
     # 1. Exchange short-lived user token for a long-lived one
     curl -s "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<SHORT_LIVED_TOKEN>"

     # 2. Get the Page access token (doesn't expire as long as the user token is valid)
     curl -s "https://graph.facebook.com/v21.0/me/accounts?access_token=<LONG_LIVED_USER_TOKEN>"
     ```
   - Use the `access_token` returned for your Page in step 2 — that's your
     `IG_ACCESS_TOKEN`.

4. **Get your Instagram Business Account ID**
   ```bash
   curl -s "https://graph.facebook.com/v21.0/<PAGE_ID>?fields=instagram_business_account&access_token=<PAGE_ACCESS_TOKEN>"
   ```
   The `instagram_business_account.id` in the response is your `IG_USER_ID`.

5. **Add both as GitHub Secrets**
   - Repo → Settings → Secrets and variables → Actions → New repository secret
   - `IG_USER_ID` = the ID from step 4
   - `IG_ACCESS_TOKEN` = the Page access token from step 3

6. **Confirm GitHub Pages is serving from `main` / `docs`**
   - Repo → Settings → Pages → Source should be `main` branch, `/docs` folder.
   - The workflow assumes images are publicly reachable at
     `https://chinna9293-lang.github.io/chinna-trading-scanner/instagram/latest.png`.
     If your Pages URL differs, update `PUBLIC_BASE_URL` in
     `scripts/post-to-instagram.mjs` or set it as a workflow env var.

7. **Test it**
   - Actions tab → "News to Instagram" → "Run workflow" (manual trigger).
   - Check the run logs, then check your Instagram feed.

## Notes

- **Token expiry**: long-lived Page tokens are generally valid until you
  change your Facebook password or revoke access, but Meta can still expire
  them — if the workflow starts failing with an auth error, redo step 3.
- **Rate limits**: Instagram allows up to 25 posts per Business account per
  24 hours via the API — 6 posts/day (every 4 hours) is well within that.
- **Image archive**: every run also saves a timestamped copy under
  `docs/instagram/archive/`. Prune that folder periodically if repo size
  becomes a concern.
