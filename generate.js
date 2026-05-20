/**
 * OAS Blog Generator
 * Fetches posts from Notion API and generates static HTML pages
 * Run: node generate.js
 * Deploy output: /dist folder to Cloudflare Pages
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
  console.error("Missing NOTION_API_KEY or NOTION_DATABASE_ID environment variables");
  process.exit(1);
}

// ─── NOTION API HELPERS ───────────────────────────────────────────────────────

function notionRequest(endpoint, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.notion.com",
      path: `/v1${endpoint}`,
      method,
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse Notion response"));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchPublishedPosts() {
  const data = await notionRequest(
    `/databases/${NOTION_DATABASE_ID}/query`,
    "POST",
    {
      filter: { property: "Published", checkbox: { equals: true } },
      sorts: [{ property: "Date", direction: "descending" }],
    }
  );
  return data.results || [];
}

async function fetchPageBlocks(pageId) {
  const data = await notionRequest(`/blocks/${pageId}/children?page_size=100`);
  return data.results || [];
}

function getProperty(page, name, type) {
  const prop = page.properties[name];
  if (!prop) return "";
  switch (type) {
    case "title":
      return prop.title?.map((t) => t.plain_text).join("") || "";
    case "text":
      return prop.rich_text?.map((t) => t.plain_text).join("") || "";
    case "checkbox":
      return prop.checkbox || false;
    case "date":
      return prop.date?.start || "";
    case "select":
      return prop.select?.name || "";
    default:
      return "";
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function blocksToHTML(blocks) {
  return blocks
    .map((block) => {
      const type = block.type;
      const content = block[type];

      function richText(items = []) {
        return items
          .map((item) => {
            let text = item.plain_text
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            if (item.annotations?.bold) text = `<strong>${text}</strong>`;
            if (item.annotations?.italic) text = `<em>${text}</em>`;
            if (item.annotations?.code) text = `<code>${text}</code>`;
            if (item.href) text = `<a href="${item.href}" target="_blank" rel="noopener">${text}</a>`;
            return text;
          })
          .join("");
      }

      switch (type) {
        case "heading_1":
          return `<h1 class="post-h1">${richText(content.rich_text)}</h1>`;
        case "heading_2":
          return `<h2 class="post-h2">${richText(content.rich_text)}</h2>`;
        case "heading_3":
          return `<h3 class="post-h3">${richText(content.rich_text)}</h3>`;
        case "paragraph":
          const text = richText(content.rich_text);
          return text ? `<p>${text}</p>` : "<br>";
        case "bulleted_list_item":
          return `<li>${richText(content.rich_text)}</li>`;
        case "numbered_list_item":
          return `<li>${richText(content.rich_text)}</li>`;
        case "quote":
          return `<blockquote>${richText(content.rich_text)}</blockquote>`;
        case "code":
          return `<pre><code>${richText(content.rich_text)}</code></pre>`;
        case "divider":
          return `<hr>`;
        case "callout":
          return `<div class="callout">${richText(content.rich_text)}</div>`;
        case "image":
          const url = content.type === "external"
            ? content.external.url
            : content.file?.url || "";
          const caption = content.caption?.map((c) => c.plain_text).join("") || "";
          return url
            ? `<figure><img src="${url}" alt="${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`
            : "";
        default:
          return "";
      }
    })
    .join("\n");
}

// ─── HTML TEMPLATES ───────────────────────────────────────────────────────────

function getBaseStyles() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --blue-deep: #0A1628;
      --blue-mid: #1A3A6B;
      --blue-brand: #1E56B0;
      --blue-light: #3B82F6;
      --blue-pale: #EBF2FF;
      --white: #FFFFFF;
      --off-white: #F8FAFF;
      --gray: #6B7280;
      --gray-light: #E5EAF2;
      --gold: #F5A623;
      --text: #0A1628;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'DM Sans', sans-serif;
      color: var(--text);
      background: var(--white);
      line-height: 1.7;
    }
    a { color: var(--blue-brand); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* NAV */
    nav {
      position: sticky; top: 0; z-index: 100;
      padding: 0 5%; height: 68px;
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--gray-light);
      box-shadow: 0 2px 16px rgba(10,22,40,0.05);
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .logo-mark {
      width: 36px; height: 36px; background: var(--blue-brand);
      border-radius: 8px; display: flex; align-items: center;
      justify-content: center; font-family: 'Playfair Display', serif;
      font-weight: 900; font-size: 16px; color: white;
    }
    .logo-text { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 18px; color: var(--blue-deep); }
    .logo-text span { color: var(--blue-brand); }
    .nav-links { display: flex; gap: 24px; list-style: none; }
    .nav-links a { font-size: 14px; font-weight: 500; color: var(--gray); transition: color 0.2s; }
    .nav-links a:hover { color: var(--blue-brand); text-decoration: none; }
    .nav-cta {
      background: var(--blue-brand); color: white !important;
      padding: 9px 20px; border-radius: 8px; font-weight: 600 !important;
      transition: background 0.2s !important;
    }
    .nav-cta:hover { background: var(--blue-mid) !important; text-decoration: none !important; }

    /* FOOTER */
    footer {
      background: var(--blue-deep); padding: 40px 5% 24px;
      margin-top: 80px;
    }
    .footer-inner {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 20px; padding-bottom: 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 20px;
    }
    .footer-brand p { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 8px; max-width: 300px; }
    .footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
    .footer-links a { font-size: 13px; color: rgba(255,255,255,0.5); transition: color 0.2s; }
    .footer-links a:hover { color: white; text-decoration: none; }
    .footer-bottom { text-align: center; font-size: 12px; color: rgba(255,255,255,0.35); }
    .footer-logo-text { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 18px; color: white; }
    .footer-logo-text span { color: var(--blue-light); }

    @media (max-width: 768px) {
      .nav-links { display: none; }
      .footer-inner { flex-direction: column; align-items: flex-start; }
    }
  `;
}

function getNavHTML() {
  return `
    <nav>
      <a href="https://oassolutions.com.ng" class="nav-logo">
        <div class="logo-mark">OAS</div>
        <span class="logo-text">OAS <span>Ltd</span></span>
      </a>
      <ul class="nav-links">
        <li><a href="https://oassolutions.com.ng">Home</a></li>
        <li><a href="https://oassolutions.com.ng/#products">Products</a></li>
        <li><a href="https://okride.com.ng">OkRide</a></li>
        <li><a href="https://oassolutions.com.ng/#contact" class="nav-cta">Contact</a></li>
      </ul>
    </nav>
  `;
}

function getFooterHTML() {
  return `
    <footer>
      <div class="footer-inner">
        <div class="footer-brand">
          <a href="https://oassolutions.com.ng" class="nav-logo" style="text-decoration:none;">
            <div class="logo-mark">OAS</div>
            <span class="footer-logo-text">OAS <span>Ltd</span></span>
          </a>
          <p>Building digital solutions that transform lives across Nigeria. RC No. RC7765644</p>
        </div>
        <div class="footer-links">
          <a href="https://oassolutions.com.ng">Home</a>
          <a href="https://okride.com.ng">OkRide</a>
          <a href="https://oassolutions.com.ng/privacy.html">Privacy Policy</a>
          <a href="https://oassolutions.com.ng/terms.html">Terms of Use</a>
          <a href="https://oassolutions.com.ng/#contact">Contact</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© ${new Date().getFullYear()} Otubusin Ademuyiwa Solutions Ltd. RC No. RC7765644. All rights reserved.</p>
      </div>
    </footer>
  `;
}

function generateIndexPage(posts) {
  const postCards = posts.length === 0
    ? `<div class="no-posts"><p>No posts published yet. Check back soon.</p></div>`
    : posts.map((post) => {
        const title = getProperty(post, "Title", "title");
        const summary = getProperty(post, "Summary", "text");
        const slug = getProperty(post, "Slug", "text");
        const date = getProperty(post, "Date", "date");
        const category = getProperty(post, "Category", "select");
        const coverImage = getProperty(post, "Cover Image URL", "text");
        return `
          <article class="post-card">
           ${coverImage ? `<div class="post-card-image"><img src="${coverImage}" alt="${title}" loading="lazy"></div>` : ""}
            ${category ? `<span class="post-category">${category}</span>` : ""}
            <h2 class="post-card-title">
              <a href="/posts/${slug}.html">${title}</a>
            </h2>
            <p class="post-card-summary">${summary}</p>
            <div class="post-card-footer">
              <span class="post-date">${formatDate(date)}</span>
              <a href="/posts/${slug}.html" class="read-more">
                Read more →
              </a>
            </div>
          </article>
        `;
      }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog — OAS Ltd</title>
  <meta name="description" content="Insights on Nigerian tech, transportation, entrepreneurship, and product development from Otubusin Ademuyiwa Solutions Ltd." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    ${getBaseStyles()}

    /* BLOG INDEX */
    .blog-hero {
      background: var(--blue-deep); padding: 80px 5% 60px;
      position: relative; overflow: hidden;
    }
    .blog-hero::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse 60% 80% at 80% 50%, rgba(30,86,176,0.4), transparent 70%);
    }
    .blog-hero-inner { position: relative; z-index: 1; max-width: 680px; }
    .blog-tag {
      display: inline-block; background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.7);
      font-size: 12px; font-weight: 500; padding: 4px 14px;
      border-radius: 100px; margin-bottom: 16px;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .blog-hero h1 {
      font-family: 'Playfair Display', serif;
      font-size: clamp(32px, 5vw, 52px); font-weight: 900;
      color: white; line-height: 1.15; letter-spacing: -1px; margin-bottom: 16px;
    }
    .blog-hero p { font-size: 16px; color: rgba(255,255,255,0.6); font-weight: 300; max-width: 520px; }

    .blog-content { max-width: 900px; margin: 0 auto; padding: 60px 5%; }

    .posts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }

    .post-card {
      border: 1px solid var(--gray-light); border-radius: 16px;
      padding: 28px; background: var(--white);
      transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
    }
    .post-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 16px 40px rgba(10,22,40,0.08);
      border-color: var(--blue-brand);
    }

    .post-card-image {
        margin: -28px -28px 20px -28px;
        border-radius: 16px 16px 0 0;
        overflow: hidden;
        height: 180px;
    }
    .post-card-image img {
        width: 100%; height: 100%;
        object-fit: cover;
    }
    .post-category {
      display: inline-block; font-size: 11px; font-weight: 600;
      color: var(--blue-brand); background: var(--blue-pale);
      padding: 3px 10px; border-radius: 20px;
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px;
    }
    .post-card-title { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; color: var(--blue-deep); margin-bottom: 10px; line-height: 1.3; }
    .post-card-title a { color: inherit; }
    .post-card-title a:hover { color: var(--blue-brand); text-decoration: none; }
    .post-card-summary { font-size: 14px; color: var(--gray); line-height: 1.65; margin-bottom: 20px; font-weight: 300; }
    .post-card-footer { display: flex; justify-content: space-between; align-items: center; }
    .post-date { font-size: 12px; color: var(--gray); }
    .read-more { font-size: 13px; font-weight: 600; color: var(--blue-brand); }
    .read-more:hover { text-decoration: none; color: var(--blue-mid); }
    .no-posts { text-align: center; padding: 60px; color: var(--gray); }

    .section-label {
      font-size: 12px; font-weight: 600; color: var(--blue-brand);
      text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 8px;
      display: flex; align-items: center; gap: 10px;
    }
    .section-label::before { content: ''; display: block; width: 24px; height: 2px; background: var(--blue-brand); border-radius: 2px; }
    .section-title {
      font-family: 'Playfair Display', serif;
      font-size: clamp(24px, 3vw, 32px); font-weight: 700;
      color: var(--blue-deep); margin-bottom: 32px; letter-spacing: -0.3px;
    }
  </style>
</head>
<body>
  ${getNavHTML()}

  <div class="blog-hero">
    <div class="blog-hero-inner">
      <div class="blog-tag">OAS Ltd Blog</div>
      <h1>Insights from the OAS Ltd team</h1>
      <p>Product updates, Nigerian tech, entrepreneurship, and lessons from building digital solutions across Nigeria.</p>
    </div>
  </div>

  <div class="blog-content">
    <div class="section-label">Latest Posts</div>
    <h2 class="section-title">All articles</h2>
    <div class="posts-grid">
      ${postCards}
    </div>
  </div>

  ${getFooterHTML()}
</body>
</html>`;
}

function generatePostPage(post, blocks) {
  const title = getProperty(post, "Title", "title");
  const summary = getProperty(post, "Summary", "text");
  const slug = getProperty(post, "Slug", "text");
  const date = getProperty(post, "Date", "date");
  const category = getProperty(post, "Category", "select");
  const content = blocksToHTML(blocks);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — OAS Ltd Blog</title>
  <meta name="description" content="${summary}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${summary}" />
  <meta property="og:url" content="https://blog.oassolutions.com.ng/posts/${slug}.html" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="icon" type="image/svg+xml" href="../favicon.svg" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    ${getBaseStyles()}

    /* POST PAGE */
    .post-header {
      background: var(--blue-deep); padding: 80px 5% 60px;
      position: relative; overflow: hidden;
    }
    .post-header::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse 60% 80% at 80% 50%, rgba(30,86,176,0.4), transparent 70%);
    }
    .post-header-inner { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; }
    .post-meta { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .post-category-tag {
      font-size: 11px; font-weight: 600; color: var(--blue-light);
      background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.3);
      padding: 4px 12px; border-radius: 20px;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .post-date-tag { font-size: 13px; color: rgba(255,255,255,0.5); }
    .post-header h1 {
      font-family: 'Playfair Display', serif;
      font-size: clamp(28px, 5vw, 48px); font-weight: 900;
      color: white; line-height: 1.15; letter-spacing: -1px; margin-bottom: 20px;
    }
    .post-summary { font-size: 17px; color: rgba(255,255,255,0.65); font-weight: 300; line-height: 1.7; max-width: 600px; }

    .post-container { max-width: 760px; margin: 0 auto; padding: 60px 5%; }

    /* Back link */
    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 14px; font-weight: 500; color: var(--blue-brand);
      margin-bottom: 48px; transition: gap 0.2s;
    }
    .back-link:hover { gap: 10px; text-decoration: none; }

    /* Post body */
    .post-body { font-size: 17px; line-height: 1.8; color: #374151; }
    .post-body p { margin-bottom: 24px; }
    .post-h1 { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 700; color: var(--blue-deep); margin: 40px 0 16px; }
    .post-h2 { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: var(--blue-deep); margin: 36px 0 14px; padding-bottom: 10px; border-bottom: 2px solid var(--blue-pale); }
    .post-h3 { font-size: 20px; font-weight: 600; color: var(--blue-deep); margin: 28px 0 10px; }
    .post-body ul, .post-body ol { margin: 0 0 24px 24px; }
    .post-body li { margin-bottom: 8px; }
    .post-body blockquote {
      border-left: 4px solid var(--blue-brand); margin: 24px 0;
      padding: 16px 24px; background: var(--blue-pale);
      border-radius: 0 10px 10px 0; font-style: italic; color: var(--blue-mid);
    }
    .post-body pre {
      background: #1E1E2E; border-radius: 10px; padding: 20px;
      overflow-x: auto; margin-bottom: 24px;
    }
    .post-body code {
      font-family: 'Courier New', monospace; font-size: 14px; color: #A6E3A1;
    }
    .post-body p code {
      background: var(--blue-pale); color: var(--blue-brand);
      padding: 2px 6px; border-radius: 4px; font-size: 14px;
    }
    .post-body figure { margin: 32px 0; }
    .post-body img { width: 100%; border-radius: 12px; }
    .post-body figcaption { font-size: 13px; color: var(--gray); text-align: center; margin-top: 8px; }
    .post-body hr { border: none; border-top: 1px solid var(--gray-light); margin: 40px 0; }
    .callout {
      background: var(--blue-pale); border-left: 4px solid var(--blue-brand);
      border-radius: 0 10px 10px 0; padding: 16px 20px; margin-bottom: 24px;
      font-size: 15px; color: var(--blue-mid);
    }
    .post-body a { color: var(--blue-brand); font-weight: 500; }

    /* Author card */
    .author-card {
      display: flex; align-items: center; gap: 16px;
      background: var(--off-white); border-radius: 16px; padding: 24px;
      margin-top: 60px; border: 1px solid var(--gray-light);
    }
    .author-avatar {
      width: 56px; height: 56px; border-radius: 50%;
      background: var(--blue-brand); display: flex; align-items: center;
      justify-content: center; font-family: 'Playfair Display', serif;
      font-size: 22px; font-weight: 700; color: white; flex-shrink: 0;
    }
    .author-name { font-size: 15px; font-weight: 600; color: var(--blue-deep); margin-bottom: 4px; }
    .author-title { font-size: 13px; color: var(--gray); }

    /* Share section */
    .share-section { margin-top: 40px; padding-top: 32px; border-top: 1px solid var(--gray-light); }
    .share-title { font-size: 14px; font-weight: 600; color: var(--gray); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
    .share-links { display: flex; gap: 12px; flex-wrap: wrap; }
    .share-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 500; padding: 8px 16px;
      border: 1px solid var(--gray-light); border-radius: 8px;
      color: var(--gray); transition: all 0.2s;
    }
    .share-link:hover { border-color: var(--blue-brand); color: var(--blue-brand); text-decoration: none; }

    /* Comments */
    .comments-section {
      margin-top: 60px;
      padding-top: 40px;
      border-top: 1px solid var(--gray-light);
    }
    .comments-title {
      font-family: 'Playfair Display', serif;
      font-size: 24px; font-weight: 700;
      color: var(--blue-deep); margin-bottom: 8px;
    }
    .comments-subtitle {
      font-size: 14px; color: var(--gray);
      margin-bottom: 24px;
    }

    /* More posts */
    .more-posts { margin-top: 60px; padding-top: 40px; border-top: 1px solid var(--gray-light); }
    .more-posts-title { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; color: var(--blue-deep); margin-bottom: 8px; }
    .more-posts-link { font-size: 15px; color: var(--blue-brand); font-weight: 500; }


  </style>
</head>
<body>
  ${getNavHTML()}

  <div class="post-header">
    <div class="post-header-inner">
      <div class="post-meta">
        ${category ? `<span class="post-category-tag">${category}</span>` : ""}
        <span class="post-date-tag">${formatDate(date)}</span>
      </div>
      <h1>${title}</h1>
      <p class="post-summary">${summary}</p>
    </div>
  </div>

  <div class="post-container">
    <a href="/" class="back-link">← Back to all posts</a>

    <div class="post-body">
      ${content}
    </div>

    <!-- Author -->
    <div class="author-card">
      <div class="author-avatar">A</div>
      <div>
        <div class="author-name">Ademuyiwa Otubusin</div>
        <div class="author-title">CEO, Otubusin Ademuyiwa Solutions Ltd</div>
      </div>
    </div>

    <!-- Share -->
    <div class="share-section">
      <div class="share-title">Share this post</div>
      <div class="share-links">
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=https://blog.oassolutions.com.ng/posts/${slug}.html" target="_blank" class="share-link">
          𝕏 Share on X
        </a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://blog.oassolutions.com.ng/posts/${slug}.html" target="_blank" class="share-link">
          in Share on LinkedIn
        </a>
        <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(title + ' — https://blog.oassolutions.com.ng/posts/' + slug + '.html')}" target="_blank" class="share-link">
          💬 Share on WhatsApp
        </a>
      </div>
    </div>

    <!-- Comments -->
    <div class="comments-section">
      <h2 class="comments-title">Comments</h2>
      <p class="comments-subtitle">Sign in with GitHub to leave a comment</p>
      <script src="https://giscus.app/client.js"
        data-repo="tay4real/oas-blog"
        data-repo-id="R_kgDOSib5Pw"
        data-category="Announcements"
        data-category-id="DIC_kwDOSib5P84C9dFj"
        data-mapping="pathname"
        data-strict="0"
        data-reactions-enabled="1"
        data-emit-metadata="0"
        data-input-position="bottom"
        data-theme="light"
        data-lang="en"
        crossorigin="anonymous"
        async>
      </script>
    </div>

    <!-- More posts -->
    <div class="more-posts">
      <div class="more-posts-title">More from OAS Ltd</div>
      <a href="/" class="more-posts-link">← View all posts</a>
    </div>
  </div>

  ${getFooterHTML()}
</body>
</html>`;
}

// ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

async function generate() {
  console.log("🚀 OAS Blog Generator starting...");

  // Create dist directories
  const distDir = path.join(__dirname, "dist");
  const postsDir = path.join(distDir, "posts");
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });

  // Fetch published posts from Notion
  console.log("📚 Fetching posts from Notion...");
  const posts = await fetchPublishedPosts();
  console.log(`✅ Found ${posts.length} published post(s)`);

  // Generate index page
  const indexHTML = generateIndexPage(posts);
  fs.writeFileSync(path.join(distDir, "index.html"), indexHTML);
  console.log("✅ Generated index.html");

  // Generate individual post pages
  for (const post of posts) {
    const slug = getProperty(post, "Slug", "text");
    const title = getProperty(post, "Title", "title");

    if (!slug) {
      console.warn(`⚠️  Skipping post "${title}" — no slug set`);
      continue;
    }

    console.log(`📝 Generating post: ${title}`);
    const blocks = await fetchPageBlocks(post.id);
    const postHTML = generatePostPage(post, blocks);
    fs.writeFileSync(path.join(postsDir, `${slug}.html`), postHTML);
    console.log(`✅ Generated posts/${slug}.html`);
  }

  console.log("\n🎉 Blog generation complete!");
  console.log(`📁 Output: ${distDir}`);
  console.log(`📊 Total posts: ${posts.length}`);
}

generate().catch((err) => {
  console.error("❌ Generation failed:", err.message);
  process.exit(1);
});