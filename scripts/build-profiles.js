/**
 * Control & Chaos — Static Profile & SEO Generator
 * Generates static HTML pages with pre-baked SEO metadata, OpenGraph, Twitter Cards,
 * and canonical links for every escort/companion profile.
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../directory/profiles');
const COMBINED_JSON = path.join(__dirname, '../directory/profiles.json');
const TEMPLATE_FILE = path.join(__dirname, '../profile/_template/index.html');
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

  // Sync combined directory/profiles.json
  fs.writeFileSync(COMBINED_JSON, JSON.stringify(allProfiles, null, 2), 'utf8');
  console.log(`✅ Synced ${allProfiles.length} profiles into directory/profiles.json`);

  for (const profile of allProfiles) {
    const id = profile.id || path.basename(file, '.json');
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
  }

  console.log('🎉 Profile static SEO generation complete!');
}

if (require.main === module) {
  buildProfiles();
}

module.exports = { buildProfiles };
