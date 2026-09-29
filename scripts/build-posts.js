/**
 * Control & Chaos — Static Post & SEO Generator
 * Generates true static HTML pages with baked-in SEO metadata for each article
 */

const fs = require('fs');
const path = require('path');

const BLOG_DATA_DIR = path.join(__dirname, '../blog/data');
const BLOG_DIR = path.join(__dirname, '../blog');

function parseSimpleMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2">$1</a>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/gim, '');
  return `<p>${html}</p>`;
}

function generatePostHtml(post, allPosts) {
  const wordCount = (post.content || '').split(/\s+/).length;
  const readMinutes = Math.max(1, Math.round(wordCount / 180));
  const renderedBody = parseSimpleMarkdown(post.content);

  // Other posts for sidebar
  const otherPosts = allPosts.filter(p => p.id !== post.id).slice(0, 4);
  const sidebarRecentHtml = otherPosts.map(p => `
    <a href="../${p.id}/" class="recent-post-item">
      <div class="recent-post-title">${p.title}</div>
      <div class="recent-post-meta">${p.date} &bull; ${p.category}</div>
    </a>
  `).join('');

  const featuredImgHtml = post.featured_image ? `
    <div class="featured-image-wrapper">
      <img src="${post.featured_image}" alt="${post.title}">
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Pre-Rendered SEO Meta Tags -->
  <title>${post.title} | Control &amp; Chaos Second Life</title>
  <meta name="description" content="${post.summary}">
  <link rel="canonical" href="https://controlandchaos.com/blog/${post.id}/">
  
  <!-- OpenGraph / Discord Rich Previews -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${post.title}">
  <meta property="og:description" content="${post.summary}">
  <meta property="og:image" content="${post.featured_image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80'}">
  <meta property="og:url" content="https://controlandchaos.com/blog/${post.id}/">
  <meta property="og:site_name" content="Control &amp; Chaos">
  
  <!-- Twitter Card SEO -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${post.title}">
  <meta name="twitter:description" content="${post.summary}">
  <meta name="twitter:image" content="${post.featured_image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80'}">

  <!-- JSON-LD Structured Data Schema -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "${post.title}",
    "description": "${post.summary}",
    "image": "${post.featured_image || ''}",
    "datePublished": "2026-10-01",
    "author": {
      "@type": "Person",
      "name": "${post.author || 'Architect of Chaos'}"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Control & Chaos Second Life"
    }
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../styles.css">

  <style>
    .article-layout {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 40px;
      align-items: start;
    }
    @media (max-width: 960px) {
      .article-layout {
        grid-template-columns: 1fr;
      }
    }
    .article-main {
      background: var(--bg-card);
      border: 1px solid var(--gold-border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: var(--shadow-lg), 0 0 25px rgba(0, 0, 0, 0.6);
    }
    @media (max-width: 600px) {
      .article-main { padding: 24px 18px; }
    }
    .featured-image-wrapper {
      width: 100%;
      height: 380px;
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 30px;
      border: 1px solid var(--gold-border);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
      background: var(--bg-dark);
    }
    @media (max-width: 600px) {
      .featured-image-wrapper { height: 220px; }
    }
    .featured-image-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .article-body {
      font-size: 16px;
      line-height: 1.8;
      color: var(--text-primary);
      font-family: var(--font-sans);
    }
    .article-body h2, .article-body h3 {
      color: var(--gold-bright);
      font-family: var(--font-heading);
      margin: 32px 0 14px;
      letter-spacing: -0.3px;
    }
    .article-body h2 { font-size: 24px; border-bottom: 1px solid var(--gold-border-subtle); padding-bottom: 8px; }
    .article-body h3 { font-size: 20px; color: var(--gold-primary); }
    .article-body p { margin-bottom: 20px; color: var(--text-primary); }
    .article-body ul, .article-body ol { margin: 0 0 24px 20px; padding-left: 10px; }
    .article-body li { margin-bottom: 10px; color: var(--text-primary); }
    .article-body a { color: var(--gold-bright); text-decoration: underline; font-weight: 600; }
    .article-body a:hover { color: #fff; }
    .article-body code {
      background: var(--bg-card-inner);
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--gold-border-subtle);
      font-family: var(--font-mono);
      font-size: 13.5px;
      color: var(--gold-bright);
    }
    .sidebar-widget {
      background: var(--bg-card);
      border: 1px solid var(--gold-border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: var(--shadow-md);
    }
    .widget-title {
      font-family: var(--font-heading);
      font-size: 16px;
      font-weight: 700;
      color: var(--gold-bright);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .recent-post-item {
      display: block;
      padding: 12px 0;
      border-bottom: 1px solid var(--gold-border-subtle);
      text-decoration: none;
      transition: transform 0.2s;
    }
    .recent-post-item:last-child { border-bottom: none; }
    .recent-post-item:hover { transform: translateX(4px); }
    .recent-post-title { color: var(--text-primary); font-size: 14px; font-weight: 600; margin-bottom: 4px; line-height: 1.4; }
    .recent-post-item:hover .recent-post-title { color: var(--gold-bright); }
    .recent-post-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
    .share-bar {
      display: flex;
      gap: 10px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid var(--gold-border-subtle);
      flex-wrap: wrap;
    }
  </style>
</head>
<body>

  <site-navbar></site-navbar>

  <!-- Article Header / Hero -->
  <header class="hero" style="min-height: 40vh; padding: 130px 0 30px;">
    <canvas id="hero-canvas"></canvas>
    <div class="container">
      <div style="font-family: var(--font-mono); font-size: 12px; color: var(--gold-muted); margin-bottom: 12px;">
        <a href="../../index.html" style="color:var(--gold-muted);">Home</a> &bull; 
        <a href="../index.html" style="color:var(--gold-muted);">News &amp; Blog</a> &bull; 
        <span style="color:var(--text-primary);">${post.title}</span>
      </div>
      
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
        <span class="section-tag" style="margin:0;">${(post.category || 'DISPATCH').toUpperCase()}</span>
        <span style="font-family:var(--font-mono); font-size:12px; color:var(--gold-bright);">${post.date || 'October 2026'}</span>
        <span style="font-family:var(--font-mono); font-size:12px; color:var(--text-muted);">&bull; By ${post.author || 'Architect of Chaos'}</span>
        <span style="font-family:var(--font-mono); font-size:12px; color:var(--text-muted);">&bull; ${readMinutes} min read</span>
      </div>

      <h1 class="hero-title" style="font-size: clamp(28px, 4vw, 44px); text-align: left; margin-bottom: 16px;">
        ${post.title}
      </h1>
      <p class="hero-desc" style="text-align: left; max-width: 800px; font-size: 16px; margin: 0; color: var(--text-muted); font-style: italic;">
        ${post.summary}
      </p>
    </div>
  </header>

  <!-- Main Article Section -->
  <main class="section" style="padding: 40px 0 80px;">
    <div class="container">
      <div class="article-layout">
        
        <!-- Left: Full Article Main Body -->
        <article class="article-main">
          ${featuredImgHtml}

          <div class="article-body">
            ${renderedBody}
          </div>

          <!-- Social Share Bar -->
          <div class="share-bar">
            <span style="font-size: 13px; color: var(--text-muted); align-self: center; font-family: var(--font-mono);">Share Post:</span>
            <button id="copy-link-btn" class="btn btn-secondary btn-sm">
              <span>📋</span> Copy Link
            </button>
            <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent('https://controlandchaos.com/blog/' + post.id + '/')}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
              <span>🐦</span> Share on X
            </a>
            <a href="../index.html" class="btn btn-gold btn-sm" style="margin-left: auto;">
              <span>&larr;</span> Back to All Posts
            </a>
          </div>
        </article>

        <!-- Right: Sidebar -->
        <aside class="article-sidebar">
          
          <!-- Faction / Sim Card -->
          <div class="sidebar-widget">
            <div class="widget-title"><span>👑</span> Chaos Manor</div>
            <p style="font-size: 13.5px; color: var(--text-muted); line-height: 1.6; margin-bottom: 16px;">
              Second Life's premier luxury gamified sanctuary, competitive XP arenas, and certified escort directory.
            </p>
            <a href="http://maps.secondlife.com/secondlife/Los%20Pengos/97/181/3000" target="_blank" rel="noopener" class="btn btn-gold btn-sm" style="width: 100%; justify-content: center;">
              <span>📍</span> Visit Us InWorld
            </a>
          </div>

          <!-- Recent Dispatches List -->
          <div class="sidebar-widget">
            <div class="widget-title"><span>📜</span> Recent Posts</div>
            <div>
              ${sidebarRecentHtml}
            </div>
          </div>

          <!-- Categories Widget -->
          <div class="sidebar-widget">
            <div class="widget-title"><span>🏷️</span> Topics</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <a href="../index.html" class="btn btn-secondary btn-sm" style="font-size: 11px;">Product Launches</a>
              <a href="../index.html" class="btn btn-secondary btn-sm" style="font-size: 11px;">Sim Events</a>
              <a href="../index.html" class="btn btn-secondary btn-sm" style="font-size: 11px;">Economy Updates</a>
              <a href="../index.html" class="btn btn-secondary btn-sm" style="font-size: 11px;">Patch Notes</a>
            </div>
          </div>

        </aside>

      </div>
    </div>
  </main>

  <site-footer></site-footer>

  <script src="../../app.js"></script>
  <script>
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href);
        copyBtn.innerHTML = '<span>✅</span> Copied!';
        setTimeout(() => { copyBtn.innerHTML = '<span>📋</span> Copy Link'; }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

// Read all post JSON files
const files = fs.readdirSync(BLOG_DATA_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const allPosts = files.map(f => JSON.parse(fs.readFileSync(path.join(BLOG_DATA_DIR, f), 'utf8')));

console.log(`Building ${allPosts.length} static SEO pages...`);

allPosts.forEach(post => {
  const postFolder = path.join(BLOG_DIR, post.id);
  if (!fs.existsSync(postFolder)) {
    fs.mkdirSync(postFolder, { recursive: true });
  }

  const htmlContent = generatePostHtml(post, allPosts);
  fs.writeFileSync(path.join(postFolder, 'index.html'), htmlContent, 'utf8');
  console.log(`Generated SEO Page: blog/${post.id}/index.html`);
});

console.log("Static generation complete!");
