/**
 * Control & Chaos — Static Profile & SEO Generator
 * Generates static HTML pages with pre-baked SEO metadata, OpenGraph, Twitter Cards,
 * and canonical links for every escort/companion profile.
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../directory/profiles');
const COMBINED_JSON = path.join(__dirname, '../directory/profiles.json');
const TEMPLATE_FILE = path.join(__dirname, '../directory/profile.html');
const PROFILE_OUT_DIR = path.join(__dirname, '../profile');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripMarkdown(md) {
  if (!md) return '';
  return String(md)
    .replace(/#+\s+/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\r\n|\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInlineMarkdown(escapedText) {
  if (!escapedText) return '';
  return escapedText
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff; font-weight:700;">$1</strong>')
    .replace(/__(.+?)__/g, '<strong style="color:#fff; font-weight:700;">$1</strong>')
    .replace(/\*([^\*]+?)\*/g, '<em style="color:#f1f5f9;">$1</em>')
    .replace(/_([^_]+?)_/g, '<em style="color:#f1f5f9;">$1</em>')
    .replace(/~~(.+?)~~/g, '<del style="color:#94a3b8;">$1</del>')
    .replace(/`([^`]+?)`/g, '<code style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-family:var(--font-mono); font-size:12.5px; color:var(--gold-bright);">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--gold-bright); text-decoration:underline;">$1</a>');
}

function renderMarkdownToHtml(text) {
  if (!text) return '';
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n{2,}/);
  
  const renderedBlocks = blocks.map(block => {
    block = block.trim();
    if (!block) return '';

    // Horizontal Rule
    if (/^(---|___|\*\*\*)$/.test(block)) {
      return '<hr style="border:0; height:1px; background:rgba(212,175,55,0.25); margin:24px 0;">';
    }

    // Headers (#, ##, ###)
    if (/^###\s+(.+)$/m.test(block)) {
      return block.replace(/^###\s+(.+)$/gm, (_, t) => `<h3 style="font-family:var(--font-heading); color:var(--gold-bright); font-size:18px; font-weight:700; margin:22px 0 10px 0;">${renderInlineMarkdown(escapeHtml(t))}</h3>`);
    }
    if (/^##\s+(.+)$/m.test(block)) {
      return block.replace(/^##\s+(.+)$/gm, (_, t) => `<h2 style="font-family:var(--font-heading); color:var(--gold-bright); font-size:22px; font-weight:800; margin:26px 0 12px 0;">${renderInlineMarkdown(escapeHtml(t))}</h2>`);
    }
    if (/^#\s+(.+)$/m.test(block)) {
      return block.replace(/^#\s+(.+)$/gm, (_, t) => `<h1 style="font-family:var(--font-heading); color:var(--gold-bright); font-size:26px; font-weight:900; margin:28px 0 14px 0;">${renderInlineMarkdown(escapeHtml(t))}</h1>`);
    }

    // Blockquote
    if (/^>\s+/m.test(block)) {
      const quoteContent = block.replace(/^>\s?/gm, '');
      const inner = renderInlineMarkdown(escapeHtml(quoteContent)).replace(/\n/g, '<br>');
      return `<blockquote style="border-left: 3px solid var(--gold-primary); background: rgba(212,175,55,0.06); padding: 14px 18px; margin: 18px 0; border-radius: 0 8px 8px 0; font-style: italic; color: #cbd5e1;">${inner}</blockquote>`;
    }

    // Unordered list
    if (/^[-*+]\s+/m.test(block)) {
      const items = block.split('\n').filter(l => l.trim()).map(line => {
        const itemText = line.replace(/^[-*+]\s+/, '');
        return `<li style="margin-bottom: 8px; line-height: 1.7;">${renderInlineMarkdown(escapeHtml(itemText))}</li>`;
      }).join('');
      return `<ul style="padding-left: 22px; margin: 16px 0; color: #e2e8f0;">${items}</ul>`;
    }

    // Ordered list
    if (/^\d+\.\s+/m.test(block)) {
      const items = block.split('\n').filter(l => l.trim()).map(line => {
        const itemText = line.replace(/^\d+\.\s+/, '');
        return `<li style="margin-bottom: 8px; line-height: 1.7;">${renderInlineMarkdown(escapeHtml(itemText))}</li>`;
      }).join('');
      return `<ol style="padding-left: 22px; margin: 16px 0; color: #e2e8f0;">${items}</ol>`;
    }

    // Standard paragraph with internal single line-breaks
    const inline = renderInlineMarkdown(escapeHtml(block)).replace(/\n/g, '<br>');
    return `<p style="margin: 0 0 18px 0; line-height: 1.8; color: #e2e8f0;">${inline}</p>`;
  });

  return renderedBlocks.filter(Boolean).join('\n');
}

function slugifyProfileName(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function calculateLowestRateFromProfile(profile) {
  if (profile.starting_rate && String(profile.starting_rate).trim()) {
    return profile.starting_rate;
  }
  const categories = profile.rate_categories || profile.services_data || profile.menu_categories || [];
  let lowestNum = Infinity;
  let lowestUnit = '';
  if (Array.isArray(categories)) {
    for (const cat of categories) {
      const services = cat.services || [];
      if (Array.isArray(services)) {
        for (const s of services) {
          if (!s || !s.price) continue;
          const num = parseInt(String(s.price).replace(/[^0-9]/g, ''), 10);
          if (!isNaN(num) && num > 0 && num < lowestNum) {
            lowestNum = num;
            lowestUnit = (s.unit || '').trim();
          }
        }
      }
    }
  }
  if (lowestNum !== Infinity) {
    let unitStr = lowestUnit;
    if (unitStr) {
      if (unitStr.toLowerCase().startsWith('per ')) {
        unitStr = '/ ' + unitStr.substring(4);
      } else if (!unitStr.startsWith('/')) {
        unitStr = '/ ' + unitStr;
      }
    } else {
      unitStr = '/ hr';
    }
    return `L$${lowestNum.toLocaleString('en-US')} ${unitStr}`;
  }
  return 'From L$2,000 / hr';
}

function buildProfiles() {
  console.log('👑 Generating static profile SEO pages & syncing profiles.json...');

  if (!fs.existsSync(PROFILES_DIR)) {
    console.warn(`[WARN] Profiles directory not found: ${PROFILES_DIR}`);
    return;
  }

  const templateHtml = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  const allProfiles = [];

  for (const file of files) {
    const filePath = path.join(PROFILES_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && (data.id || data.name)) {
        allProfiles.push(data);
      }
    } catch (e) {
      console.warn(`[WARN] Failed to parse ${file}:`, e.message);
    }
  }

  const usedSlugs = new Set();
  for (const profile of allProfiles) {
    const baseSlug = slugifyProfileName(profile.name) || 'profile';
    let id = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(id)) {
      id = `${baseSlug}-${suffix++}`;
    }
    usedSlugs.add(id);
    profile.slug = id;

    if (!profile.starting_rate || !String(profile.starting_rate).trim()) {
      profile.starting_rate = calculateLowestRateFromProfile(profile);
    }
  }

  // Sync combined directory/profiles.json, including generated public slugs.
  fs.writeFileSync(COMBINED_JSON, JSON.stringify(allProfiles, null, 2), 'utf8');
  console.log(`✅ Synced ${allProfiles.length} profiles into directory/profiles.json`);

  for (const profile of allProfiles) {
    const id = profile.slug;
    const outFolder = path.join(PROFILE_OUT_DIR, id);
    if (!fs.existsSync(outFolder)) {
      fs.mkdirSync(outFolder, { recursive: true });
    }

    const pageUrl = `https://controlandchaos.co.uk/profile/${id}/`;
    const defaultSeoTitle = `${profile.name || id} — Luxury Rate Card & Services | Control & Chaos`;
    const finalSeoTitle = profile.seo_title || defaultSeoTitle;
    
    let defaultDesc = profile.tagline || (profile.about ? profile.about.substring(0, 160).replace(/(\r\n|\n|\r)/gm, ' ') + '...' : `Verified Second Life companion and escort rate card for ${profile.name || id}. View interactive booking quotes, Lovense toy syncing, and direct IM.`);
    const finalSeoDesc = profile.seo_description || defaultDesc;

    let finalSeoImg = profile.seo_image || profile.banner_image || profile.avatar_image || '';
    if (finalSeoImg && !finalSeoImg.startsWith('http') && !finalSeoImg.startsWith('//')) {
      finalSeoImg = `https://controlandchaos.co.uk${finalSeoImg.startsWith('/') ? '' : '/'}${finalSeoImg}`;
    }
    if (!finalSeoImg) {
      finalSeoImg = 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=1200&q=80';
    }

    const isDomme = (profile.role_type === 'domme' || profile.role_type === 'dom');
    const jobTitle = profile.role || (isDomme ? 'Dominant Companion' : 'Submissive Companion');

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": profile.name || id,
      "url": pageUrl,
      "jobTitle": jobTitle,
      "description": finalSeoDesc,
      "image": finalSeoImg
    };

    let bakedHtml = templateHtml;

    // Replace Title
    bakedHtml = bakedHtml.replace(
      /<title id="page-title">[\s\S]*?<\/title>/i,
      `<title id="page-title">${escapeHtml(finalSeoTitle)}</title>`
    );

    // Replace Meta Description
    bakedHtml = bakedHtml.replace(
      /<meta name="description" id="meta-description" content="[\s\S]*?">/i,
      `<meta name="description" id="meta-description" content="${escapeHtml(finalSeoDesc)}">`
    );

    // Replace Canonical Link
    bakedHtml = bakedHtml.replace(
      /<link rel="canonical" id="meta-canonical" href="[\s\S]*?">/i,
      `<link rel="canonical" id="meta-canonical" href="${pageUrl}">`
    );

    // Replace OpenGraph Title
    bakedHtml = bakedHtml.replace(
      /<meta property="og:title" id="og-title" content="[\s\S]*?">/i,
      `<meta property="og:title" id="og-title" content="${escapeHtml(finalSeoTitle)}">`
    );

    // Replace OpenGraph Description
    bakedHtml = bakedHtml.replace(
      /<meta property="og:description" id="og-desc" content="[\s\S]*?">/i,
      `<meta property="og:description" id="og-desc" content="${escapeHtml(finalSeoDesc)}">`
    );

    // Replace OpenGraph Image
    bakedHtml = bakedHtml.replace(
      /<meta property="og:image" id="og-image" content="[\s\S]*?">/i,
      `<meta property="og:image" id="og-image" content="${escapeHtml(finalSeoImg)}">`
    );

    // Replace OpenGraph URL
    bakedHtml = bakedHtml.replace(
      /<meta property="og:url" id="og-url" content="[\s\S]*?">/i,
      `<meta property="og:url" id="og-url" content="${pageUrl}">`
    );

    // Replace Twitter Title
    bakedHtml = bakedHtml.replace(
      /<meta name="twitter:title" id="twitter-title" content="[\s\S]*?">/i,
      `<meta name="twitter:title" id="twitter-title" content="${escapeHtml(finalSeoTitle)}">`
    );

    // Replace Twitter Description
    bakedHtml = bakedHtml.replace(
      /<meta name="twitter:description" id="twitter-desc" content="[\s\S]*?">/i,
      `<meta name="twitter:description" id="twitter-desc" content="${escapeHtml(finalSeoDesc)}">`
    );

    // Replace Twitter Image
    bakedHtml = bakedHtml.replace(
      /<meta name="twitter:image" id="twitter-image" content="[\s\S]*?">/i,
      `<meta name="twitter:image" id="twitter-image" content="${escapeHtml(finalSeoImg)}">`
    );

    // Replace JSON-LD Schema
    bakedHtml = bakedHtml.replace(
      /<script type="application\/ld\+json" id="jsonld-schema">[\s\S]*?<\/script>/i,
      `<script type="application/ld+json" id="jsonld-schema">\n  ${JSON.stringify(jsonLd, null, 2).replace(/\n/g, '\n  ')}\n  </script>`
    );

    const destFile = path.join(outFolder, 'index.html');
    fs.writeFileSync(destFile, bakedHtml, 'utf8');
    console.log(`✨ Built pre-rendered SEO static profile for [${id}] -> profile/${id}/index.html`);

    const blogPosts = Array.isArray(profile.blog_posts) ? profile.blog_posts : (Array.isArray(profile.blog) ? profile.blog : []);
    const blogDir = path.join(outFolder, 'blog');
    if (fs.existsSync(blogDir)) {
      fs.rmSync(blogDir, { recursive: true, force: true });
    }
    if (blogPosts.length > 0) {
      fs.mkdirSync(blogDir, { recursive: true });

      const usedPostSlugs = new Set();
      // Pre-pass: Assign slugs to ALL blog posts first so otherPosts has valid slugs
      blogPosts.forEach((post, pIdx) => {
        let pSlug = post.slug || slugifyProfileName(post.title) || (`entry-${pIdx + 1}`);
        let pSuffix = 2;
        while (usedPostSlugs.has(pSlug)) {
          pSlug = `${pSlug}-${pSuffix++}`;
        }
        usedPostSlugs.add(pSlug);
        post.slug = pSlug;
      });

      // Pass 2: Write dedicated HTML for each post
      blogPosts.forEach((post, pIdx) => {
        const pSlug = post.slug;
        const postOutDir = path.join(blogDir, pSlug);
        if (!fs.existsSync(postOutDir)) fs.mkdirSync(postOutDir, { recursive: true });

        const otherPosts = blogPosts.filter((_, idx) => idx !== pIdx).slice(0, 3);
        const postHtml = generateCompanionBlogPostHtml(profile, post, otherPosts);
        fs.writeFileSync(path.join(postOutDir, 'index.html'), postHtml, 'utf8');
        console.log(`  📝 Built dedicated blog page: profile/${id}/blog/${pSlug}/index.html`);
      });
    }
  }

  console.log('🎉 Profile & Blog static SEO generation complete!');
}

function generateCompanionBlogPostHtml(profile, post, otherPosts) {
  const profileSlug = profile.slug;
  const postSlug = post.slug;
  const postTitle = post.title || 'Public Journal Entry';
  const postTag = post.tag || '💬 Update';
  const postDate = post.timestamp || 'Recent';
  const wordCount = (post.content || '').split(/\s+/).length;
  const readMinutes = Math.max(1, Math.round(wordCount / 180));
  const isDomme = (profile.role_type === 'domme' || profile.role_type === 'dom');
  const roleLabel = isDomme ? 'DOM' : 'SUB';
  const roleTitle = profile.role || (isDomme ? 'Verified Dominant Companion' : 'Verified Submissive Companion');
  const startingRate = profile.starting_rate || 'From L$3,000 / hr';
  const avatarImg = profile.avatar_image || '';
  
  // Dynamic SEO & OG Image (Attached photo -> profile banner -> avatar -> luxury fallback)
  let postImg = post.seo_image || post.media_url || profile.banner_image || profile.avatar_image || '';
  if (postImg && !postImg.startsWith('http') && !postImg.startsWith('//')) {
    postImg = `https://controlandchaos.co.uk${postImg.startsWith('/') ? '' : '/'}${postImg}`;
  }
  if (!postImg) {
    postImg = 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=1200&q=80';
  }

  const pageUrl = `https://controlandchaos.co.uk/profile/${profileSlug}/blog/${postSlug}/`;
  const defaultSeoTitle = `${postTitle} — ${profile.name}'s Blog | Control & Chaos`;
  const finalSeoTitle = post.seo_title || defaultSeoTitle;

  const plainContentSnippet = post.content ? stripMarkdown(post.content) : '';
  const defaultSeoDesc = plainContentSnippet 
    ? (plainContentSnippet.substring(0, 157) + (plainContentSnippet.length > 157 ? '...' : '')) 
    : `Read this free public journal update from ${profile.name} on Control & Chaos.`;
  const finalSeoDesc = post.seo_description || defaultSeoDesc;

  const uKey = (profile.avatar_uuid || profile.id || '') + '_' + (post.id || postSlug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": postTitle,
    "description": finalSeoDesc,
    "image": postImg,
    "datePublished": "2026-10-03",
    "author": {
      "@type": "Person",
      "name": profile.name || profile.sl_username,
      "url": `https://controlandchaos.co.uk/profile/${profileSlug}/`
    },
    "publisher": {
      "@type": "Organization",
      "name": "Control & Chaos Second Life",
      "url": "https://controlandchaos.co.uk"
    }
  };

  const hardwareBadges = (profile.hardware_compat || []).slice(0, 3).map(h => `
    <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; font-family:var(--font-mono); background:rgba(212,175,55,0.08); border:1px solid rgba(212,175,55,0.3); color:var(--gold-bright); padding:3px 8px; border-radius:6px;">
      <span>${escapeHtml(h.icon || '🔌')}</span> ${escapeHtml(h.name || 'Lovense')}
    </span>
  `).join('');

  const morePostsHtml = (otherPosts || []).map(op => `
    <a href="../${op.slug}/" style="display:block; padding:12px 14px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.07); border-radius:10px; text-decoration:none; margin-bottom:10px; transition:all 0.2s ease;">
      <div style="font-size:11px; font-family:var(--font-mono); color:var(--gold-muted); margin-bottom:4px;">${escapeHtml(op.timestamp || 'Recent')} &bull; ${escapeHtml(op.tag || 'Update')}</div>
      <div style="font-size:13.5px; font-weight:700; color:#fff; line-height:1.4;">${escapeHtml(op.title || 'Journal Entry')}</div>
    </a>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${escapeHtml(finalSeoTitle)}</title>
  <meta name="description" content="${escapeHtml(finalSeoDesc)}">
  <link rel="canonical" href="${pageUrl}">

  <!-- OpenGraph / Discord Rich Previews -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(finalSeoTitle)}">
  <meta property="og:description" content="${escapeHtml(finalSeoDesc)}">
  <meta property="og:image" content="${escapeHtml(postImg)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:site_name" content="Control &amp; Chaos">

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(finalSeoTitle)}">
  <meta name="twitter:description" content="${escapeHtml(finalSeoDesc)}">
  <meta name="twitter:image" content="${escapeHtml(postImg)}">

  <!-- JSON-LD Schema -->
  <script type="application/ld+json">
  ${JSON.stringify(jsonLd, null, 2).replace(/\n/g, '\n  ')}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">

  <style>
    :root {
      --gold-primary: #d4af37;
      --gold-bright: #ffd700;
      --gold-muted: #e7c96a;
      --gold-border: rgba(212, 175, 55, 0.4);
      --gold-border-subtle: rgba(212, 175, 55, 0.15);
      --bg-dark: #0a0908;
      --bg-card: #14110e;
      --font-heading: 'Cinzel', serif;
      --font-body: 'Plus Jakarta Sans', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    body {
      background-color: var(--bg-dark);
      color: #e5e5e5;
      font-family: var(--font-body);
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }

    .article-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 20px 80px;
      display: grid;
      grid-template-columns: 1.45fr 0.85fr;
      gap: 40px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .article-container {
        grid-template-columns: 1fr;
        gap: 30px;
      }
    }

    .article-box {
      background: linear-gradient(165deg, #181512 0%, #100e0c 100%);
      border: 1px solid var(--gold-border-subtle);
      border-radius: 18px;
      padding: 36px 38px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    }

    @media (max-width: 600px) {
      .article-box {
        padding: 24px 20px;
      }
    }

    .creator-sticky-box {
      position: sticky;
      top: 100px;
      background: linear-gradient(165deg, #181512 0%, #100e0c 100%);
      border: 1px solid var(--gold-border);
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.7);
    }

    .breadcrumbs {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--gold-muted);
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .breadcrumbs a {
      color: var(--gold-muted);
      text-decoration: none;
    }

    .breadcrumbs a:hover {
      color: var(--gold-bright);
      text-decoration: underline;
    }

    .role-badge {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(212,175,55,0.2);
      border: 1px solid var(--gold-border);
      color: var(--gold-bright);
    }

    .article-content {
      font-size: 16px;
      line-height: 1.8;
      color: #e2e8f0;
      margin: 24px 0 32px;
      word-break: break-word;
    }

    .article-content p {
      margin: 0 0 18px 0;
      line-height: 1.8;
    }

    .article-content p:last-child {
      margin-bottom: 0;
    }

    .article-content h1, .article-content h2, .article-content h3 {
      font-family: var(--font-heading);
      color: var(--gold-bright);
      margin-top: 26px;
      margin-bottom: 12px;
      line-height: 1.3;
    }

    .article-content ul, .article-content ol {
      padding-left: 24px;
      margin: 16px 0;
    }

    .article-content li {
      margin-bottom: 8px;
      line-height: 1.7;
    }

    .article-content blockquote {
      border-left: 3px solid var(--gold-primary);
      background: rgba(212, 175, 55, 0.06);
      padding: 14px 20px;
      margin: 20px 0;
      border-radius: 0 8px 8px 0;
      font-style: italic;
      color: #cbd5e1;
    }

    .article-content strong {
      color: #ffffff;
      font-weight: 700;
    }

    .article-content em {
      color: #f1f5f9;
    }

    .article-content a {
      color: var(--gold-bright);
      text-decoration: underline;
    }

    .article-content a:hover {
      color: #fff;
    }

    .article-content code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--gold-bright);
    }

    .article-hero-media {
      width: 100%;
      max-height: 480px;
      border-radius: 14px;
      object-fit: cover;
      border: 1px solid var(--gold-border-subtle);
      margin: 20px 0;
      display: block;
    }

    .btn-gold {
      background: linear-gradient(135deg, #d4af37 0%, #b8860b 100%);
      color: #000;
      font-weight: 800;
      padding: 12px 20px;
      border-radius: 8px;
      border: 1px solid var(--gold-bright);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13.5px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 0 15px rgba(212,175,55,0.25);
    }

    .btn-gold:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 22px rgba(212,175,55,0.45);
      color: #000;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: #cbd5e1;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-secondary:hover {
      border-color: var(--gold-border);
      color: #fff;
      background: rgba(212,175,55,0.1);
    }

    #share-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #181512;
      border: 1px solid var(--gold-bright);
      color: #ffd700;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-family: var(--font-mono);
      font-weight: 700;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8);
      z-index: 999999;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }

    #share-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>

  <site-navbar></site-navbar>

  <main style="padding-top: 100px;">
    <div class="article-container">

      <!-- Left Column: Article Body -->
      <div>
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a> <span>/</span>
          <a href="/directory/">Service Providers</a> <span>/</span>
          <a href="../../">${escapeHtml(profile.name)}</a> <span>/</span>
          <a href="../../?tab=blog">Public Blog</a> <span>/</span>
          <span style="color:#fff;">${escapeHtml(postTitle)}</span>
        </nav>

        <article class="article-box">
          <!-- Tag & Read Time -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <span class="role-badge" style="background:rgba(212,175,55,0.12); color:var(--gold-bright); font-size:11px; padding:3px 10px;">
              ${escapeHtml(postTag)}
            </span>
            <span style="font-family:var(--font-mono); font-size:11.5px; color:var(--gold-muted);">
              ${escapeHtml(postDate)} &bull; ${readMinutes} min read
            </span>
          </div>

          <!-- Main Article Title -->
          <h1 style="font-family:var(--font-heading); font-size:28px; font-weight:900; color:#fff; line-height:1.25; margin:0 0 18px 0; text-shadow:0 2px 10px rgba(0,0,0,0.5);">
            ${escapeHtml(postTitle)}
          </h1>

          <!-- Author Header -->
          <div style="display:flex; align-items:center; gap:14px; padding:14px 0; border-top:1px solid rgba(255,255,255,0.06); border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="width:46px; height:46px; border-radius:50%; overflow:hidden; border:1.5px solid var(--gold-border); background:#14110e; flex-shrink:0;">
              ${avatarImg ? `<img src="${avatarImg}" alt="${profile.name}" style="width:100%; height:100%; object-fit:cover;">` : (isDomme ? '👑' : '🩷')}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <a href="../../" style="font-family:var(--font-heading); font-size:16px; font-weight:800; color:var(--gold-bright); text-decoration:none;">
                  ${escapeHtml(profile.name)}
                </a>
                <span class="role-badge">${roleLabel}</span>
              </div>
              <div style="font-family:var(--font-mono); font-size:11.5px; color:var(--gold-muted);">
                @${escapeHtml(profile.sl_username || profile.id)} &bull; ${escapeHtml(profile.location || 'Control & Chaos')}
              </div>
            </div>
          </div>

          <!-- Hero Media (if present) -->
          ${post.media_url ? `
            <img src="${escapeHtml(post.media_url)}" alt="${escapeHtml(postTitle)}" class="article-hero-media" loading="eager">
          ` : ''}

          <!-- Article Body (Rendered Markdown) -->
          <div class="article-content" id="blog-article-content">
            ${renderMarkdownToHtml(post.content || '')}
          </div>

          <!-- Article Action Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; padding-top:20px; border-top:1px solid rgba(255,255,255,0.08); flex-wrap:wrap; gap:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <button type="button" class="btn-secondary" id="blog-like-btn" onclick="toggleArticleLike('${uKey}')" style="font-size:12.5px;">
                <span id="blog-like-heart">🤍</span>
                <span id="blog-like-count">${post.likes || 0} Likes</span>
              </button>

              <button type="button" class="btn-secondary" onclick="copyArticleShareLink()" style="font-size:12.5px;">
                <span>🔗</span> Share Article
              </button>
            </div>

            <a href="../../?tab=blog" class="btn-secondary" style="font-size:12.5px;">
              <span>←</span> More Entries
            </a>
          </div>

        </article>

        <!-- More Posts from Author Section -->
        ${otherPosts && otherPosts.length > 0 ? `
          <div style="margin-top: 30px;">
            <h3 style="font-family:var(--font-heading); font-size:18px; color:var(--gold-bright); margin-bottom:14px;">
              More from ${escapeHtml(profile.name)}
            </h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
              ${morePostsHtml}
            </div>
          </div>
        ` : ''}

      </div>

      <!-- Right Column: Sticky Creator Profile & Booking Card -->
      <div>
        <aside class="creator-sticky-box">
          <div style="text-align:center; margin-bottom:18px;">
            <div style="width:84px; height:84px; border-radius:50%; overflow:hidden; border:2px solid var(--gold-bright); margin:0 auto 12px; box-shadow:0 0 20px rgba(212,175,55,0.35);">
              ${avatarImg ? `<img src="${avatarImg}" alt="${profile.name}" style="width:100%; height:100%; object-fit:cover;">` : (isDomme ? '👑' : '🩷')}
            </div>
            <h2 style="font-family:var(--font-heading); font-size:20px; font-weight:800; color:#fff; margin:0 0 4px 0;">
              ${escapeHtml(profile.name)}
            </h2>
            <div style="font-size:12px; color:var(--gold-muted); margin-bottom:8px;">
              ${escapeHtml(roleTitle)}
            </div>
            <div style="display:inline-block; background:rgba(212,175,55,0.12); border:1px solid var(--gold-border); color:var(--gold-bright); font-family:var(--font-heading); font-weight:800; font-size:13px; padding:4px 12px; border-radius:20px;">
              ⚡ Starting at ${escapeHtml(startingRate)}
            </div>
          </div>

          ${profile.tagline ? `
            <p style="font-size:12.5px; color:#cbd5e1; line-height:1.55; text-align:center; margin-bottom:18px; font-style:italic;">
              "${escapeHtml(profile.tagline)}"
            </p>
          ` : ''}

          <!-- Hardware Compatibility Badges -->
          ${hardwareBadges ? `
            <div style="margin-bottom:18px; text-align:center; display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
              ${hardwareBadges}
            </div>
          ` : ''}

          <!-- Direct Calls to Action -->
          <div style="display:flex; flex-direction:column; gap:10px;">
            <a href="../../#profile-tabs-nav" class="btn-gold" style="width:100%; box-sizing:border-box;">
              <span>📋</span> View Full Rate Card &amp; Menus
            </a>
            <a href="../../?tab=ratecard#booking-calc" class="btn-secondary" style="width:100%; box-sizing:border-box;">
              <span>✉️</span> Submit Booking Enquiry
            </a>
            <a href="${escapeHtml(profile.slurl || 'secondlife://Chaos%20Manor/128/142/23')}" target="_blank" rel="noopener" class="btn-secondary" style="width:100%; box-sizing:border-box;">
              <span>📍</span> Teleport In-World (SL) ↗
            </a>
          </div>

          <div style="margin-top:16px; text-align:center;">
            <a href="/directory/" style="font-family:var(--font-mono); font-size:11px; color:var(--gold-muted); text-decoration:none;">
              &larr; Browse All Directory Companions
            </a>
          </div>
        </aside>
      </div>

    </div>
  </main>

  <div id="share-toast">
    <span>🔗</span> Direct Article Link Copied!
  </div>

  <site-footer></site-footer>

  <script src="/app.js"></script>
  <script>
    const uKey = '${uKey}';
    const baseLikes = ${post.likes || 0};

    function initArticleLikes() {
      const hasLiked = localStorage.getItem('cc_blog_liked_' + uKey) === '1';
      updateLikeUI(hasLiked);
    }

    function toggleArticleLike() {
      const hasLiked = localStorage.getItem('cc_blog_liked_' + uKey) === '1';
      localStorage.setItem('cc_blog_liked_' + uKey, hasLiked ? '0' : '1');
      updateLikeUI(!hasLiked);
    }

    function updateLikeUI(isLiked) {
      const heart = document.getElementById('blog-like-heart');
      const count = document.getElementById('blog-like-count');
      if (heart) heart.textContent = isLiked ? '❤️' : '🤍';
      if (count) count.textContent = (baseLikes + (isLiked ? 1 : 0)) + ' Likes';
    }

    function copyArticleShareLink() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
      }
      const toast = document.getElementById('share-toast');
      if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
      }
    }

    document.addEventListener('DOMContentLoaded', initArticleLikes);
  </script>
</body>
</html>`;
}

if (require.main === module) {
  buildProfiles();
}

module.exports = { buildProfiles };
