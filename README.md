# OAS Ltd Blog

Notion-powered blog for [blog.oassolutions.com.ng](https://blog.oassolutions.com.ng)

Built by Otubusin Ademuyiwa Solutions Ltd.

---

## How it works

1. Write blog posts in Notion
2. Tick the **Published** checkbox when ready to go live
3. GitHub Actions runs every 6 hours and regenerates the blog automatically
4. Or trigger manually from the GitHub Actions tab

## Setup

### 1. Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add these four secrets:

| Secret name | Where to get it |
|---|---|
| `NOTION_API_KEY` | notion.so/my-integrations → your integration → Internal Integration Token |
| `NOTION_DATABASE_ID` | Your Notion database URL — the ID between the last / and ? |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → Edit Cloudflare Pages template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right sidebar on any page |

### 2. Create Cloudflare Pages project

1. Go to Cloudflare dashboard → Workers & Pages → Create → Pages
2. Connect to your `oas-blog` GitHub repository
3. Build command: `node generate.js`
4. Build output directory: `dist`
5. Add environment variables: `NOTION_API_KEY` and `NOTION_DATABASE_ID`

### 3. Add custom domain

In Cloudflare Pages → your project → Custom domains → Add `blog.oassolutions.com.ng`

### 4. Run locally to test

```bash
NOTION_API_KEY=your_key NOTION_DATABASE_ID=your_db_id node generate.js
```

Open `dist/index.html` in your browser to preview.

---

## Notion database properties required

| Property | Type | Purpose |
|---|---|---|
| Title | Title | Post title |
| Slug | Text | URL path e.g. `introducing-okride` |
| Summary | Text | Short description shown on index |
| Published | Checkbox | Only published posts appear |
| Date | Date | Publication date |
| Category | Select | OkRide, Company News, Tech, Nigeria |

---

## Publishing a new post

1. Open Notion → OAS Blog database
2. Create a new row
3. Fill in Title, Slug, Summary, Date, Category
4. Write the post body inside the page
5. Tick **Published** ✅
6. Wait up to 6 hours for auto-deploy, or trigger manually in GitHub Actions

---

© Otubusin Ademuyiwa Solutions Ltd — RC7765644