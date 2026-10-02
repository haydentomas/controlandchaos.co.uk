import { getStore } from "@netlify/blobs";

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
      const profileUrl = new URL(`/profile/${targetSlug}/`, "https://controlandchaos.co.uk");
      
      // Preserve query params
      url.searchParams.forEach((val, key) => profileUrl.searchParams.set(key, val));
      profileUrl.searchParams.set("custom_domain", cleanDomain);

      // Fetch the profile page HTML from the origin
      const profileResponse = await fetch(profileUrl.toString());
      if (profileResponse.ok) {
        const html = await profileResponse.text();
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=0, must-revalidate",
            "X-Custom-Domain-Owner": targetSlug
          }
        });
      }
    }
  } catch (err) {
    console.error("[CUSTOM DOMAIN ROUTER ERROR]", err);
  }

  return context.next();
}
