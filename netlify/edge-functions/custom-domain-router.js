import { getStore } from "@netlify/blobs";
import { parseHTML } from "linkedom";

function slugifyProfileName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  
  // Standard domains pass through immediately without overhead
  const isPrimaryDomain = 
    hostname === "controlandchaos.co.uk" ||
    hostname === "www.controlandchaos.co.uk" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".netlify.app");

  if (isPrimaryDomain) {
    return context.next();
  }

  // Handle custom creator domains (e.g. alekzane.com, mistressvane.com)
  const cleanDomain = hostname.replace(/^www\./, "");
  const path = url.pathname;

  // Let static assets (CSS, JS, images, fonts) pass through or fetch from origin
  const isStaticAsset = 
    path.startsWith("/dist/") ||
    path.startsWith("/styles.css") ||
    path.startsWith("/app.js") ||
    path.startsWith("/images/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/settings/") ||
    path.startsWith("/directory/profiles") ||
    path.startsWith("/favicon.svg") ||
    path.startsWith("/.netlify/") ||
    path.match(/\.(css|js|png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/i);

  if (isStaticAsset) {
    return context.next();
  }

  try {
    const store = getStore({ name: "directory-profiles", consistency: "strong" });
    if (!store) {
      return context.next();
    }

    // 1. Try fast O(1) lookup by domain key
    let customProfile = await store.get(`domain_${cleanDomain}`, { type: "json" }).catch(() => null);

    // 2. Fallback: Search all_profiles
    if (!customProfile) {
      let allProfiles = await store.get("all_profiles", { type: "json" }).catch(() => null);
      if (!allProfiles) {
        const raw = await store.get("all_profiles").catch(() => null);
        if (raw && typeof raw === "string") allProfiles = JSON.parse(raw);
      }
      if (allProfiles && typeof allProfiles === "object") {
        customProfile = Object.values(allProfiles).find(p => {
          if (!p || !p.custom_domain) return false;
          const pDomain = String(p.custom_domain).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
          return pDomain === cleanDomain;
        }) || null;
      }
    }

    if (customProfile) {
      // Enforce VIP status requirement for custom domains
      let isVip = customProfile.is_vip === true || customProfile.plan === "vip";
      
      let subscriptions = await store.get("all_subscriptions", { type: "json" }).catch(() => null);
      if (!subscriptions) {
        const raw = await store.get("all_subscriptions").catch(() => null);
        if (raw && typeof raw === "string") subscriptions = JSON.parse(raw);
      }

      const ownerId = String(customProfile.avatar_uuid || "").toLowerCase();
      const sub = subscriptions && (
        subscriptions[ownerId] ||
        subscriptions[String(customProfile.id || "").toLowerCase()] ||
        subscriptions[String(customProfile.sl_username || "").toLowerCase()]
      );

      if (sub && (sub.is_vip === true || sub.plan === "vip")) {
        isVip = true;
      }

      if (!isVip) {
        return new Response(
          `<!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>VIP Feature Required — Control & Chaos</title>
            <style>
              body { background: #070709; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
              .box { background: #121018; border: 1px solid #d4af37; padding: 40px; border-radius: 16px; max-width: 480px; box-shadow: 0 0 40px rgba(212,175,55,0.2); }
              h1 { color: #d4af37; font-size: 24px; margin-bottom: 8px; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
              a { color: #ffd700; text-decoration: none; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="box">
              <div style="font-size: 40px; margin-bottom: 12px;">👑</div>
              <h1>Custom Domain Pending VIP Active</h1>
              <p>Custom vanity domains are exclusively available on <strong>Control & Chaos VIP Listings</strong>. Please renew or upgrade your listing in-world.</p>
              <p><a href="https://controlandchaos.co.uk/directory/">Visit Control & Chaos Directory &rarr;</a></p>
            </div>
          </body>
          </html>`,
          { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      // Rewrite to the creator's profile page internally
      const targetSlug = customProfile.slug || customProfile.id || slugifyProfileName(customProfile.name);
      const profilePath = `/profile/${encodeURIComponent(targetSlug)}/`;
      const segments = path.split('/').filter(Boolean);
      if (segments[segments.length - 1] === 'index.html') segments.pop();
      if (segments[0] === 'profile' && segments[1] === targetSlug) segments.splice(0, 2);
      const isBlogIndex = segments.length === 1 && segments[0] === 'blog';
      const isBlogArticle = segments.length === 2 && segments[0] === 'blog';
      if (segments.length && !isBlogIndex && !isBlogArticle) {
        return new Response('Page not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
      const articleSlug = isBlogArticle ? segments[1] : '';
      const upstreamPath = articleSlug ? `${profilePath}blog/${articleSlug}/` : profilePath;
      const profileUrl = new URL(upstreamPath, "https://controlandchaos.co.uk");
      
      // Preserve query params
      url.searchParams.forEach((val, key) => profileUrl.searchParams.set(key, val));
      profileUrl.searchParams.set("custom_domain", cleanDomain);
      if (isBlogIndex) profileUrl.searchParams.set('tab', 'blog');

      // Fetch the profile page HTML from the origin
      const profileResponse = await fetch(profileUrl.toString());
      if (!profileResponse.ok) return profileResponse;
      if (profileResponse.ok) {
        const { document } = parseHTML(await profileResponse.text());
        const ownerMarker = document.createElement('meta');
        ownerMarker.setAttribute('name', 'cc-profile-id');
        ownerMarker.setAttribute('content', targetSlug);
        document.head.appendChild(ownerMarker);

        for (const anchor of document.querySelectorAll('a[href]')) {
          const href = anchor.getAttribute('href');
          if (!href || href.startsWith('#')) continue;
          const destination = new URL(href, profileUrl);
          if (destination.origin !== profileUrl.origin) continue;
          if (destination.pathname.startsWith(profilePath)) {
            const mirrorPath = '/' + destination.pathname.substring(profilePath.length);
            anchor.setAttribute('href', mirrorPath + destination.search + destination.hash);
          } else {
            anchor.setAttribute('href', destination.toString());
          }
        }

        // 3. Standalone White-Label Mode
        // If white-label mode is enabled (default true for custom domain profiles),
        // strip the C&C global navigation header & directory footer so the rate card looks 100% standalone
        const isWhitelabel = customProfile.whitelabel_mode !== false && customProfile.is_whitelabel !== false;
        
        if (isWhitelabel) {
          const whitelabelCss = `
          <style id="cc-whitelabel-standalone-mode">
            site-navbar, 
            site-footer, 
            .site-header, 
            header.hero site-navbar,
            footer.site-footer, 
            #main-header, 
            #main-footer, 
            .directory-breadcrumbs, 
            .back-to-directory-btn, 
            .nav-logo,
            #profile-renewal-banner {
              display: none !important;
            }
            body {
              padding-top: 0 !important;
              margin-top: 0 !important;
            }
            header.hero#profile-hero-header {
              padding-top: 50px !important;
            }
            main.companion-article-page {
              padding-top: 40px;
            }
          </style>
          `;

          const creatorFooter = `
          <footer class="creator-standalone-footer" style="padding: 36px 20px; text-align: center; font-size: 11.5px; color: #64748b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 40px; letter-spacing: 0.04em;">
            &copy; ${new Date().getFullYear()} <strong style="color: #cbd5e1;">${escapeHtml(customProfile.name || 'Verified Creator')}</strong>. All Rights Reserved. Private Concierge &amp; Official Rate Card.
          </footer>
          `;

          document.head.insertAdjacentHTML('beforeend', whitelabelCss);
          document.body.classList.add('is-whitelabel-custom-domain');
          document.body.insertAdjacentHTML('beforeend', creatorFooter);
        }

        return new Response(document.toString(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Custom-Domain-Owner": targetSlug,
            "X-Custom-Domain-Whitelabel": isWhitelabel ? "active" : "standard"
          }
        });
      }
    }
  } catch (err) {
    console.error("[CUSTOM DOMAIN ROUTER ERROR]", err);
  }

  return context.next();
}

function escapeHtml(value) {
  const { document } = parseHTML('<html><body></body></html>');
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}
