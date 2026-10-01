import { getStore } from "@netlify/blobs";

export default async function handler(request, context) {
  const url = new URL(request.url);
  const path = url.pathname; // e.g. /profile/alek-zane/
  
  // Extract profile slug
  const match = path.match(/^\/profile\/([a-zA-Z0-9_.-]+)/);
  if (!match) {
    return context.next();
  }

  const profileId = match[1].toLowerCase();
  if (profileId === '_template' || profileId === 'index.html') {
    return context.next();
  }

  // Get original response from origin / static pre-render
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  
  if (!contentType.includes("text/html")) {
    return response;
  }

  try {
    let customProfile = null;
    try {
      const store = getStore({ name: "directory-profiles", consistency: "strong" });
      if (store) {
        customProfile = await store.get(profileId, { type: "json" });
      }
    } catch(e) {}

    if (!customProfile) {
      return response;
    }

    let text = await response.text();

    const finalTitle = customProfile.seo_title || `${customProfile.name || profileId} — Luxury Rate Card & Services | Control & Chaos`;
    const finalDesc = customProfile.seo_description || customProfile.tagline || (customProfile.about ? customProfile.about.substring(0, 160).replace(/(\r\n|\n|\r)/gm, " ") + '...' : `Verified Second Life companion and escort rate card for ${customProfile.name || profileId}. View interactive booking quotes, Lovense toy syncing, and direct IM.`);
    
    let finalImg = customProfile.seo_image || customProfile.banner_image || customProfile.avatar_image || '';
    if (finalImg && !finalImg.startsWith('http') && !finalImg.startsWith('//')) {
      finalImg = `https://controlandchaos.co.uk${finalImg.startsWith('/') ? '' : '/'}${finalImg}`;
    }
    if (!finalImg) {
      finalImg = 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=1200&q=80';
    }

    // Replace Title
    text = text.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title id="page-title">${escapeHtml(finalTitle)}</title>`);
    text = text.replace(/<meta name="description"[^>]*content="[^"]*"/i, `<meta name="description" id="meta-description" content="${escapeHtml(finalDesc)}"`);
    
    // Replace OpenGraph Meta Tags (Discord, Facebook, LinkedIn, iMessage)
    text = text.replace(/<meta property="og:title"[^>]*content="[^"]*"/i, `<meta property="og:title" id="og-title" content="${escapeHtml(finalTitle)}"`);
    text = text.replace(/<meta property="og:description"[^>]*content="[^"]*"/i, `<meta property="og:description" id="og-desc" content="${escapeHtml(finalDesc)}"`);
    text = text.replace(/<meta property="og:image"[^>]*content="[^"]*"/i, `<meta property="og:image" id="og-image" content="${escapeHtml(finalImg)}"`);
    
    // Replace Twitter Meta Tags
    text = text.replace(/<meta name="twitter:title"[^>]*content="[^"]*"/i, `<meta name="twitter:title" id="twitter-title" content="${escapeHtml(finalTitle)}"`);
    text = text.replace(/<meta name="twitter:description"[^>]*content="[^"]*"/i, `<meta name="twitter:description" id="twitter-desc" content="${escapeHtml(finalDesc)}"`);
    text = text.replace(/<meta name="twitter:image"[^>]*content="[^"]*"/i, `<meta name="twitter:image" id="twitter-image" content="${escapeHtml(finalImg)}"`);

    return new Response(text, {
      status: response.status,
      headers: response.headers
    });
  } catch (err) {
    return response;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
