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
        let allProfiles = null;
        if (!customProfile) {
          allProfiles = await store.get("all_profiles", { type: "json" });
        }
        if (!allProfiles) {
          const raw = await store.get("all_profiles");
          if (raw && typeof raw === "string") allProfiles = JSON.parse(raw);
        }
        if (!customProfile && allProfiles && typeof allProfiles === "object") {
          customProfile = Object.values(allProfiles).find(profile => slugifyProfileName(profile.slug || profile.name) === profileId) || null;
        }

        if (customProfile) {
          let subscriptions = await store.get("all_subscriptions", { type: "json" });
          if (!subscriptions) {
            const raw = await store.get("all_subscriptions");
            if (raw && typeof raw === "string") subscriptions = JSON.parse(raw);
          }
          const ownerId = String(customProfile.avatar_uuid || "").toLowerCase();
          const subscription = subscriptions && (
            subscriptions[ownerId] ||
            subscriptions[String(customProfile.id || "").toLowerCase()] ||
            subscriptions[String(customProfile.sl_username || "").toLowerCase()]
          );
          const expiry = subscription && subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0;
          const active = subscription && subscription.published !== false && (subscription.is_vip === true || expiry > Date.now());
          const legacyActive = !customProfile.avatar_uuid && customProfile.published !== false && (!customProfile.expires_at || new Date(customProfile.expires_at).getTime() > Date.now());
          if (!active && !legacyActive) {
            return new Response("This directory listing is inactive.", {
              status: 404,
              headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
            });
          }
        }
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

function slugifyProfileName(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
