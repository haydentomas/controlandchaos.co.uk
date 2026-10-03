import { getStore } from "@netlify/blobs";
import { parseHTML } from "linkedom";

export default async function handler(request, context) {
  const url = new URL(request.url);
  const path = url.pathname; // e.g. /profile/alek-zane/ or /profile/alek-zane/blog/yeah-ok-rude-boy/
  
  // Extract profile slug and optional blog post slug
  const blogMatch = path.match(/^\/profile\/([a-zA-Z0-9_.-]+)\/blog\/([a-zA-Z0-9_.-]+)/i);
  const profileMatch = path.match(/^\/profile\/([a-zA-Z0-9_.-]+)/i);
  if (!profileMatch) {
    return context.next();
  }

  const profileId = profileMatch[1].toLowerCase();
  const postSlug = blogMatch ? blogMatch[2].toLowerCase() : null;

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

    const { document } = parseHTML(await response.clone().text());

    let finalTitle = '';
    let finalDesc = '';
    let finalImg = '';
    let pageUrl = `https://controlandchaos.co.uk/profile/${profileId}/`;
    let ogType = 'profile';
    let articlePost = null;

    // If requesting an individual blog article
    if (postSlug) {
      const blogList = customProfile.blog_posts || customProfile.blog || [];
      const cleanPostSlug = postSlug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const matchedPost = blogList.find(p => {
        const s = (p.slug || (p.title ? slugifyProfileName(p.title) : '')).toLowerCase();
        const id = String(p.id || '').toLowerCase();
        return s === cleanPostSlug || id === cleanPostSlug || (cleanPostSlug && s && cleanPostSlug.includes(s)) || (cleanPostSlug && s && s.includes(cleanPostSlug));
      });

      if (matchedPost) {
        articlePost = matchedPost;
        ogType = 'article';
        pageUrl = `https://controlandchaos.co.uk/profile/${profileId}/blog/${matchedPost.slug || cleanPostSlug}/`;
        
        finalTitle = matchedPost.seo_title || `${matchedPost.title || 'Journal Entry'} — ${customProfile.name || profileId}'s Blog | Control & Chaos`;
        
        const plainSnippet = matchedPost.content ? stripMarkdown(matchedPost.content) : '';
        const defaultPostDesc = plainSnippet ? (plainSnippet.substring(0, 157) + (plainSnippet.length > 157 ? '...' : '')) : `Read this free public journal update from ${customProfile.name || profileId} on Control & Chaos.`;
        finalDesc = matchedPost.seo_description || defaultPostDesc;

        finalImg = matchedPost.seo_image || matchedPost.media_url || customProfile.seo_image || customProfile.banner_image || customProfile.avatar_image || '';
      }
    }

    // Default Profile Rate Card SEO fallback
    if (!finalTitle) {
      finalTitle = customProfile.seo_title || `${customProfile.name || profileId} — Luxury Rate Card & Services | Control & Chaos`;
      finalDesc = customProfile.seo_description || customProfile.tagline || (customProfile.about ? customProfile.about.substring(0, 160).replace(/(\r\n|\n|\r)/gm, " ") + '...' : `Verified Second Life companion and escort rate card for ${customProfile.name || profileId}. View interactive booking quotes, Lovense toy syncing, and direct IM.`);
      finalImg = customProfile.seo_image || customProfile.banner_image || customProfile.avatar_image || '';
    }
    
    if (finalImg && !finalImg.startsWith('http') && !finalImg.startsWith('//')) {
      finalImg = `https://controlandchaos.co.uk${finalImg.startsWith('/') ? '' : '/'}${finalImg}`;
    }
    if (!finalImg) {
      finalImg = 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=1200&q=80';
    }

    let title = document.querySelector('title');
    if (!title) {
      title = document.createElement('title');
      document.head.appendChild(title);
    }
    title.textContent = finalTitle;

    const metadata = [
      ['name', 'description', finalDesc],
      ['property', 'og:title', finalTitle],
      ['property', 'og:description', finalDesc],
      ['property', 'og:image', finalImg],
      ['property', 'og:url', pageUrl],
      ['property', 'og:type', ogType],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', finalTitle],
      ['name', 'twitter:description', finalDesc],
      ['name', 'twitter:image', finalImg]
    ];
    for (const [attribute, name, content] of metadata) {
      let tags = Array.from(document.querySelectorAll(`meta[${attribute}="${name}"]`));
      if (!tags.length) {
        const tag = document.createElement('meta');
        tag.setAttribute(attribute, name);
        document.head.appendChild(tag);
        tags = [tag];
      }
      for (const tag of tags) tag.setAttribute('content', content);
    }

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', pageUrl);

    if (articlePost) {
      const vip = customProfile.is_vip === true || customProfile.plan === 'vip';
      const tabFeatures = { feed: 'vip_feed', blog: 'public_blog', gallery: 'full_gallery' };
      for (const tab of document.querySelectorAll('[data-profile-tab]')) {
        const name = tab.getAttribute('data-profile-tab');
        const disabled = ((name === 'feed' || name === 'gallery') && !vip) || (vip && customProfile.feature_visibility?.[tabFeatures[name]] === false);
        if (disabled) { tab.remove(); continue; }
        const badge = tab.querySelector('.tab-badge');
        if (badge) {
          const count = name === 'feed' ? (customProfile.posts || []).length : name === 'gallery' ? (customProfile.gallery || []).filter(item => item && item.image).length : (customProfile.blog_posts || customProfile.blog || []).length;
          badge.textContent = String(count);
        }
      }
      let schema = document.querySelector('script[type="application/ld+json"]');
      if (!schema) {
        schema = document.createElement('script');
        schema.setAttribute('type', 'application/ld+json');
        document.head.appendChild(schema);
      }
      schema.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: articlePost.title || 'Journal Entry',
        description: finalDesc,
        image: finalImg,
        url: pageUrl,
        author: {
          '@type': 'Person',
          name: customProfile.name || profileId,
          url: `https://controlandchaos.co.uk/profile/${profileId}/`
        },
        publisher: {
          '@type': 'Organization',
          name: 'Control & Chaos',
          url: 'https://controlandchaos.co.uk/'
        }
      }).replace(/</g, '\\u003c');
    }

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('etag');
    headers.set('Cache-Control', 'no-store');

    return new Response(document.toString(), {
      status: response.status,
      headers
    });
  } catch (err) {
    return response;
  }
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
