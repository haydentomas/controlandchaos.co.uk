const crypto = require('crypto');

// Shared Secret (Must match SECRET_KEY in CC_Directory_Kiosk.lsl)
const SECRET_KEY = process.env.DIRECTORY_SECRET_KEY || "CC_DIRECTORY_SECRET_2026_GOLD";

// Known avatar mappings (UUID <-> Slugs <-> Usernames)
const KNOWN_AVATARS = {
  "b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec": ["alek-zane", "alek.zane", "alek zane", "alek.resident"],
  "e8d64b18-3a9b-4b2e-a5b6-c9a8e7d6f5a1": ["alexis-vane", "alexis.vane", "alexis vane"],
  "alek-zane": ["b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec", "alek.zane", "alek zane"],
  "alexis-vane": ["e8d64b18-3a9b-4b2e-a5b6-c9a8e7d6f5a1", "alexis.vane", "alexis vane"]
};

// In-Memory Live Status Cache (Preserved during active function lifecycle)
let gLiveStatuses = {
  "b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec": { status: "Busy / In Session", timestamp: Date.now() },
  "alek-zane": { status: "Busy / In Session", timestamp: Date.now() },
  "alek.zane": { status: "Busy / In Session", timestamp: Date.now() },
  "alexis-vane": { status: "Available / In-World", timestamp: Date.now() },
  "alexis.vane": { status: "Available / In-World", timestamp: Date.now() }
};

// Subscription entitlements are loaded from Blobs; process memory is only a cache.
let gSubscriptions = {};

// In-Memory Real-Time Tribute Goal Progress Cache
let gTributeGoals = {
  "b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec": {
    title: "Formal Gala Menswear & Collar Upgrades",
    target_amount: 30000,
    current_amount: 18500,
    currency: "L$"
  },
  "alek-zane": {
    title: "Formal Gala Menswear & Collar Upgrades",
    target_amount: 30000,
    current_amount: 18500,
    currency: "L$"
  },
  "e8d64b18-3a9b-4b2e-a5b6-c9a8e7d6f5a1": {
    title: "VIP Penthouse Renovation & Designer Corset",
    target_amount: 50000,
    current_amount: 32500,
    currency: "L$"
  },
  "alexis-vane": {
    title: "VIP Penthouse Renovation & Designer Corset",
    target_amount: 50000,
    current_amount: 32500,
    currency: "L$"
  }
};

// In-Memory Real-Time Custom Profiles Cache (Updated dynamically via Studio Editor)
let gCustomProfiles = {};

function slugifyProfileName(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let getStore;
let connectLambda;
let blobImportError = null;
try {
  const blobsModule = require('@netlify/blobs');
  getStore = blobsModule.getStore;
  connectLambda = blobsModule.connectLambda;
} catch (e) {
  blobImportError = e.message;
}

let lastStoreError = null;

function getProfilesStore(event) {
  if (connectLambda && event) {
    try {
      connectLambda(event);
    } catch (e) {
      lastStoreError = 'connectLambda error: ' + e.message;
    }
  }

  if (getStore) {
    try {
      const store = getStore('directory-profiles');
      if (store) return store;
    } catch (e1) {
      lastStoreError = 'getStore directory-profiles failed: ' + e1.message;
      try {
        const store = getStore({ name: 'directory-profiles' });
        if (store) return store;
      } catch (e2) {
        lastStoreError = 'getStore object failed: ' + e2.message;
      }
    }
  } else {
    lastStoreError = 'getStore function not imported. Import error: ' + blobImportError;
  }
  return null;
}

function verifyToken(uuid, token, secret, payload) {
  const cleanToken = token ? String(token).trim().toLowerCase() : (payload && payload.token ? String(payload.token).trim().toLowerCase() : '');
  const adminToken = process.env.ADMIN_EDIT_TOKEN;
  if (adminToken && cleanToken && cleanToken === adminToken.toLowerCase()) {
    return true;
  }

  if (!cleanToken) return false;

  // 3. Collect all possible candidate keys (UUIDs, usernames, slugs, profile IDs)
  const candidateKeys = new Set();
  if (uuid) {
    const u = String(uuid).trim().toLowerCase();
    candidateKeys.add(u);
    candidateKeys.add(u.replace(/[^a-z0-9]/g, '-'));
    candidateKeys.add(u.replace(/-/g, '.'));
  }
  if (payload) {
    if (payload.uuid) candidateKeys.add(String(payload.uuid).trim().toLowerCase());
    if (payload.id) candidateKeys.add(String(payload.id).trim().toLowerCase());
    if (payload.username) candidateKeys.add(String(payload.username).trim().toLowerCase());
    if (payload.profileData) {
      if (payload.profileData.avatar_uuid) candidateKeys.add(String(payload.profileData.avatar_uuid).trim().toLowerCase());
      if (payload.profileData.id) candidateKeys.add(String(payload.profileData.id).trim().toLowerCase());
      if (payload.profileData.sl_username) candidateKeys.add(String(payload.profileData.sl_username).trim().toLowerCase());
    }
  }

  // Add all mapped aliases from KNOWN_AVATARS
  for (const k of Array.from(candidateKeys)) {
    if (KNOWN_AVATARS[k]) {
      KNOWN_AVATARS[k].forEach(alias => candidateKeys.add(alias.toLowerCase()));
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(nowSeconds / 86400);

  const secretsToCheck = [SECRET_KEY];

  // 4. Check rolling tokens (15-day rolling window: -7 to +7 days)
  for (const candidate of candidateKeys) {
    for (const sec of secretsToCheck) {
      // Check static hash
      const staticHash = crypto.createHash('md5').update(`${candidate}:${sec}`).digest('hex').toLowerCase();
      if (staticHash === cleanToken || staticHash.startsWith(cleanToken) || cleanToken.startsWith(staticHash.substring(0, 12))) {
        return true;
      }

      // Check daily rolling hashes
      for (let d = currentDay - 7; d <= currentDay + 7; d++) {
        const fullHash = crypto
          .createHash('md5')
          .update(`${candidate}:${d}:${sec}`)
          .digest('hex')
          .toLowerCase();

        if (
          fullHash === cleanToken || 
          fullHash.startsWith(cleanToken) || 
          cleanToken.startsWith(fullHash.substring(0, 12)) ||
          fullHash.substring(0, cleanToken.length) === cleanToken
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function isSubscriptionActive(subscription) {
  if (!subscription || subscription.published === false) return false;
  if (subscription.is_vip === true) return true;
  const expiry = subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0;
  return Number.isFinite(expiry) && expiry > Date.now();
}

async function loadSubscriptions(store) {
  if (!store) return gSubscriptions;
  try {
    let stored = await store.get('all_subscriptions', { type: 'json' });
    if (!stored) {
      const raw = await store.get('all_subscriptions');
      if (raw && typeof raw === 'string') stored = JSON.parse(raw);
    }
    if (stored && typeof stored === 'object') gSubscriptions = { ...gSubscriptions, ...stored };
  } catch (e) {
    lastStoreError = 'Subscription load error: ' + e.message;
  }
  return gSubscriptions;
}

async function saveSubscriptions(store) {
  if (!store) throw new Error('Subscription storage is unavailable.');
  if (store.setJSON) {
    await store.setJSON('all_subscriptions', gSubscriptions);
  } else if (store.set) {
    await store.set('all_subscriptions', JSON.stringify(gSubscriptions));
  } else {
    throw new Error('Subscription storage does not support writes.');
  }
}

function verifyKioskPaymentToken(uuid, tier, durationDays, paymentToken) {
  if (!uuid || !paymentToken || !tier || !durationDays) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(nowSeconds / 86400);
  for (let day = currentDay - 7; day <= currentDay + 7; day++) {
    const expected = crypto.createHash('md5')
      .update(`${String(uuid).toLowerCase().trim()}:paid:${tier}:${durationDays}:${day}:${SECRET_KEY}`)
      .digest('hex').substring(0, 16);
    if (expected === String(paymentToken).toLowerCase().trim()) return true;
  }
  return false;
}

async function verifyPayPalOrder(orderId, tier, durationDays) {
  const tiers = {
    'Tier 1 Standard Listing': { amount: '3.99', days: 30 },
    'Tier 2 VIP Featured Listing': { amount: '9.99', days: 30 },
    'Tier 3 Royal Lifetime Listing': { amount: '29.99', days: 36500 }
  };
  const expected = tiers[tier];
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!expected || !orderId || !clientId || !clientSecret || Number(durationDays) !== expected.days) return false;

  const apiBase = process.env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const authResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!authResponse.ok) return false;
  const authData = await authResponse.json();
  if (!authData.access_token) return false;

  const orderResponse = await fetch(`${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${authData.access_token}` }
  });
  if (!orderResponse.ok) return false;
  const order = await orderResponse.json();
  if (order.status !== 'COMPLETED' || !Array.isArray(order.purchase_units)) return false;

  return order.purchase_units.some(unit =>
    Array.isArray(unit.payments?.captures) && unit.payments.captures.some(capture =>
      capture.status === 'COMPLETED' &&
      capture.amount?.currency_code === 'USD' &&
      Number(capture.amount.value) === Number(expected.amount)
    )
  );
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Support GET request to retrieve all live in-world statuses, dynamic profiles, subscriptions, and tribute goals
  if (event.httpMethod === 'GET') {
    const query = event.queryStringParameters || {};
    const targetId = (query.id || query.uuid || query.slug || query.username || '').toLowerCase().trim();

    if (query.action === 'subscription_status') {
      const authorized = verifyToken(targetId, query.token, '', { uuid: targetId });
      const subscription = gSubscriptions[targetId] || null;
      const expiry = subscription && subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0;
      const active = !!(authorized && subscription && subscription.published !== false && (subscription.is_vip === true || expiry > Date.now()));
      return {
        statusCode: authorized ? 200 : 403,
        headers,
        body: JSON.stringify({ success: authorized, active })
      };
    }

    let foundProfile = null;

    const store = getProfilesStore(event);
    await loadSubscriptions(store);

    if (query.action === 'checkout_config') {
      return {
        statusCode: process.env.PAYPAL_CLIENT_ID ? 200 : 503,
        headers,
        body: JSON.stringify({
          paypal_client_id: process.env.PAYPAL_CLIENT_ID || null,
          paypal_env: process.env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live'
        })
      };
    }

    if (query.action === 'editor_access') {
      const authorized = verifyToken(targetId, query.token);
      const subscription = gSubscriptions[targetId];
      const isAdmin = !!process.env.ADMIN_EDIT_TOKEN && query.token === process.env.ADMIN_EDIT_TOKEN;
      const allowed = authorized && (isAdmin || isSubscriptionActive(subscription));
      return {
        statusCode: allowed ? 200 : 403,
        headers,
        body: JSON.stringify({
          success: allowed,
          allowed,
          is_admin: authorized && isAdmin,
          subscription: subscription || null,
          error: authorized ? 'An active directory subscription is required.' : 'Invalid editor access token.'
        })
      };
    }

    if (targetId) {
      if (gCustomProfiles[targetId]) {
        foundProfile = gCustomProfiles[targetId];
      } else if (KNOWN_AVATARS[targetId]) {
        for (const alias of KNOWN_AVATARS[targetId]) {
          if (gCustomProfiles[alias.toLowerCase()]) {
            foundProfile = gCustomProfiles[alias.toLowerCase()];
            break;
          }
        }
      }
      if (!foundProfile) {
        for (const k of Object.keys(gCustomProfiles)) {
          if (k.toLowerCase() === targetId || k.toLowerCase().replace(/[\s\.]+/g, '-') === targetId) {
            foundProfile = gCustomProfiles[k];
            break;
          }
        }
      }
      if (!foundProfile) {
        foundProfile = Object.values(gCustomProfiles).find(profile => slugifyProfileName(profile.slug || profile.name) === targetId) || null;
      }

      // If not in memory, query Netlify Blobs
      if (!foundProfile && store) {
        try {
          foundProfile = await store.get(targetId, { type: 'json' });
          if (!foundProfile) {
            const raw = await store.get(targetId);
            if (raw && typeof raw === 'string') foundProfile = JSON.parse(raw);
          }
          if (!foundProfile && KNOWN_AVATARS[targetId]) {
            for (const alias of KNOWN_AVATARS[targetId]) {
              foundProfile = await store.get(alias.toLowerCase(), { type: 'json' });
              if (!foundProfile) {
                const raw = await store.get(alias.toLowerCase());
                if (raw && typeof raw === 'string') foundProfile = JSON.parse(raw);
              }
              if (foundProfile) break;
            }
          }
          if (foundProfile) {
            gCustomProfiles[targetId] = foundProfile;
          }
        } catch(e) {}
      }
    }

    // Try loading all profiles from Blobs store if memory is empty
    if (Object.keys(gCustomProfiles).length === 0 && store) {
      try {
        let allStored = await store.get('all_profiles', { type: 'json' });
        if (!allStored) {
          const raw = await store.get('all_profiles');
          if (raw && typeof raw === 'string') allStored = JSON.parse(raw);
        }
        if (allStored && typeof allStored === 'object') {
          gCustomProfiles = { ...allStored };
          if (targetId && gCustomProfiles[targetId]) {
            foundProfile = gCustomProfiles[targetId];
          } else if (targetId) {
            foundProfile = Object.values(gCustomProfiles).find(profile => slugifyProfileName(profile.slug || profile.name) === targetId) || null;
          }
        }
      } catch(e) {}
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        profile: foundProfile,
        profiles: gCustomProfiles,
        statuses: gLiveStatuses,
        subscriptions: gSubscriptions,
        tributeGoals: gTributeGoals,
        blobDebug: {
          storeAvailable: !!store,
          lastStoreError,
          blobImportError
        },
        timestamp: new Date().toISOString()
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { uuid, id, username, name, token, action, profileData, status, tier, duration_days, days, published, is_vip } = payload;

    const targetKey = uuid || id || (profileData && (profileData.avatar_uuid || profileData.id || profileData.sl_username)) || 'profile';
    const adminAuthorized = !!process.env.ADMIN_EDIT_TOKEN && String(token || '').trim() === process.env.ADMIN_EDIT_TOKEN;
    let validPaymentRegistration = false;
    if (action === 'register_paid') {
      if (payload.payment_provider === 'paypal') {
        validPaymentRegistration = verifyToken(uuid, token) && await verifyPayPalOrder(payload.payment_ref, tier, duration_days);
      } else {
        validPaymentRegistration = verifyKioskPaymentToken(uuid, tier, duration_days, payload.payment_token);
      }
    }
    const requiresAdmin = action === 'admin_grant_time' || action === 'admin_toggle_publish';

    if (requiresAdmin ? !adminAuthorized : action === 'register_paid' ? !validPaymentRegistration : !verifyToken(targetKey, token, '', payload)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: action === 'register_paid' ? 'Payment could not be verified.' : 'Unauthorized: Invalid or expired access token.' })
      };
    }

    const cleanUuid = String(targetKey).toLowerCase().trim();
    const cleanId = (id || (profileData && profileData.id)) ? String(id || profileData.id).toLowerCase().trim() : null;

    console.log(`[DIRECTORY UPDATE] Action: ${action || 'save_profile'} for UUID: ${cleanUuid} | Status: ${status}`);

    // 1. Live Status Updates
    if (status) {
      const keysToUpdate = new Set();
      keysToUpdate.add(cleanUuid);
      if (cleanId) keysToUpdate.add(cleanId);

      if (username) {
        const u = String(username).toLowerCase().trim();
        keysToUpdate.add(u);
        keysToUpdate.add(u.replace(/[\s\.]+/g, '-'));
      }
      if (name) {
        const n = String(name).toLowerCase().trim();
        keysToUpdate.add(n);
        keysToUpdate.add(n.replace(/[\s\.]+/g, '-'));
      }

      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => keysToUpdate.add(alias.toLowerCase()));
      }

      const entry = {
        status: status,
        timestamp: Date.now()
      };

      keysToUpdate.forEach(k => {
        gLiveStatuses[k] = entry;
      });
    }

    // 2. Paid Subscription Registration (from Kiosk or PayPal Checkout)
    if (action === 'register_paid') {
      const store = getProfilesStore(event);
      await loadSubscriptions(store);
      const dur = duration_days || (tier && tier.includes('3') ? 3650 : 30);
      const current = gSubscriptions[cleanUuid];
      const currentExpiry = current && current.expires_at ? new Date(current.expires_at).getTime() : 0;
      const expiryBase = Math.max(Date.now(), Number.isFinite(currentExpiry) ? currentExpiry : 0);
      const expiry = new Date(expiryBase + (dur * 86400000)).toISOString();
      const subEntry = {
        tier: tier || 'Tier 1 Standard',
        published: true,
        is_vip: (dur >= 3650),
        expires_at: expiry,
        updated_at: new Date().toISOString()
      };

      gSubscriptions[cleanUuid] = subEntry;
      if (cleanId) gSubscriptions[cleanId] = subEntry;
      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gSubscriptions[alias.toLowerCase()] = subEntry; });
      }
      await saveSubscriptions(store);
    }

    // 3. Admin: Grant Time
    if (action === 'admin_grant_time') {
      const existing = gSubscriptions[cleanUuid] || gSubscriptions[cleanId] || { published: true, tier: 'Tier 1 Standard' };
      if (is_vip) {
        existing.is_vip = true;
        existing.expires_at = '2030-12-31T23:59:59Z';
      } else {
        const currentExp = existing.expires_at ? new Date(existing.expires_at).getTime() : Date.now();
        const base = Math.max(Date.now(), currentExp);
        const addMs = (days || 30) * 86400000;
        existing.expires_at = new Date(base + addMs).toISOString();
      }
      existing.published = true;

      gSubscriptions[cleanUuid] = existing;
      if (cleanId) gSubscriptions[cleanId] = existing;
      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gSubscriptions[alias.toLowerCase()] = existing; });
      }
      await saveSubscriptions(getProfilesStore(event));
    }

    // 4. Admin: Toggle Publish
    if (action === 'admin_toggle_publish') {
      const existing = gSubscriptions[cleanUuid] || gSubscriptions[cleanId] || { tier: 'Tier 1 Standard', expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
      existing.published = (published === true);
      gSubscriptions[cleanUuid] = existing;
      if (cleanId) gSubscriptions[cleanId] = existing;
      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gSubscriptions[alias.toLowerCase()] = existing; });
      }
      await saveSubscriptions(getProfilesStore(event));
    }

    // 5. Add Tribute / Tip Sync (from In-World Tip Jar, Throne, Cash App, or Web Confirmation)
    if (action === 'add_tribute') {
      const rawAmountStr = String(payload.amount || '500').trim();
      const donor = payload.tributor || payload.donor || payload.username || 'Anonymous Supporter';
      const method = payload.method || 'Tribute';
      const badge = payload.badge || (method ? `💎 ${method}` : '💎 Tributor');

      const existingGoal = gTributeGoals[cleanUuid] || gTributeGoals[cleanId] || {
        title: 'Tribute Goal',
        target_amount: 30000,
        current_amount: 0,
        currency: 'L$',
        supporters: []
      };

      const goalCurrency = existingGoal.currency || 'L$';
      let addedToGoal = 0;
      let displayAmount = '';

      const isDollarInput = rawAmountStr.includes('$') && !rawAmountStr.toLowerCase().includes('l$');
      const isPoundInput = rawAmountStr.includes('£');
      const numericVal = parseFloat(rawAmountStr.replace(/[^0-9\.]/g, '')) || 0;

      if (goalCurrency === 'L$') {
        if (isDollarInput) {
          addedToGoal = Math.round(numericVal * 250); // ~$1 = L$250
          displayAmount = `$${numericVal.toFixed(0)} (~L$${addedToGoal.toLocaleString()})`;
        } else if (isPoundInput) {
          addedToGoal = Math.round(numericVal * 315); // ~£1 = L$315
          displayAmount = `£${numericVal.toFixed(0)} (~L$${addedToGoal.toLocaleString()})`;
        } else {
          addedToGoal = Math.round(numericVal);
          displayAmount = `L$${addedToGoal.toLocaleString()}`;
        }
      } else if (goalCurrency === '$' || goalCurrency === 'USD') {
        if (rawAmountStr.toLowerCase().includes('l$')) {
          addedToGoal = Math.round((numericVal / 250) * 100) / 100;
          displayAmount = `$${addedToGoal.toFixed(2)}`;
        } else {
          addedToGoal = numericVal;
          displayAmount = `$${numericVal.toFixed(2)}`;
        }
      } else {
        addedToGoal = numericVal;
        displayAmount = `${goalCurrency}${numericVal.toLocaleString()}`;
      }

      existingGoal.current_amount = (existingGoal.current_amount || 0) + addedToGoal;
      if (!Array.isArray(existingGoal.supporters)) existingGoal.supporters = [];
      existingGoal.supporters.unshift({
        name: donor,
        amount: displayAmount,
        badge: badge
      });
      existingGoal.supporters = existingGoal.supporters.slice(0, 5); // Keep top 5

      gTributeGoals[cleanUuid] = existingGoal;
      if (cleanId) gTributeGoals[cleanId] = existingGoal;
      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gTributeGoals[alias.toLowerCase()] = existingGoal; });
      }
    }

    // 6. Save & Publish Full Profile Data (from Studio Editor /directory/edit/)
    if (action === 'save_profile' && profileData) {
      const store = getProfilesStore(event);
      await loadSubscriptions(store);
      const subscription = gSubscriptions[cleanUuid];
      if (!adminAuthorized && !isSubscriptionActive(subscription)) {
        return {
          statusCode: 402,
          headers,
          body: JSON.stringify({ error: 'An active directory subscription is required before you can publish or edit a profile.' })
        };
      }

      const baseSlug = slugifyProfileName(profileData.name) || 'profile';
      let knownProfiles = Object.values(gCustomProfiles);
      if (store) {
        try {
          let storedProfiles = await store.get('all_profiles', { type: 'json' });
          if (!storedProfiles) {
            const raw = await store.get('all_profiles');
            if (raw && typeof raw === 'string') storedProfiles = JSON.parse(raw);
          }
          if (storedProfiles && typeof storedProfiles === 'object') {
            gCustomProfiles = { ...storedProfiles, ...gCustomProfiles };
            knownProfiles = Object.values(gCustomProfiles);
          }
        } catch(e) {}
      }

      const slugIsTaken = slug => knownProfiles.some(existing =>
        existing &&
        slugifyProfileName(existing.slug || existing.name) === slug &&
        String(existing.avatar_uuid || '').toLowerCase().trim() !== cleanUuid
      );
      let publicSlug = baseSlug;
      if (slugIsTaken(publicSlug)) {
        let suffix = 2;
        publicSlug = `${baseSlug}-${suffix++}`;
        while (slugIsTaken(publicSlug)) {
          publicSlug = `${baseSlug}-${suffix++}`;
        }
      }

      profileData.slug = publicSlug;
      profileData.id = publicSlug;
      profileData.published = true;
      profileData.is_vip = !!(subscription && subscription.is_vip);
      profileData.expires_at = subscription && subscription.expires_at;
      profileData.managed_subscription = true;
      const pId = publicSlug;
      const pUsername = (profileData.sl_username || '').toLowerCase().trim();

      for (const key of Object.keys(gCustomProfiles)) {
        const existingProfile = gCustomProfiles[key];
        const sameOwner = String(existingProfile && existingProfile.avatar_uuid || '').toLowerCase().trim() === cleanUuid;
        const oldSlug = slugifyProfileName(existingProfile && (existingProfile.slug || existingProfile.name));
        if (sameOwner && key === oldSlug && key !== pId && key !== pUsername) {
          delete gCustomProfiles[key];
          if (store && store.delete) await store.delete(key);
        }
      }
      
      console.log(`[SAVE_PROFILE] Saving profile: uuid=${cleanUuid}, id=${pId}, username=${pUsername}, role=${profileData.role}`);
      
      gCustomProfiles[cleanUuid] = profileData;
      gCustomProfiles[pId] = profileData;
      if (pUsername) gCustomProfiles[pUsername] = profileData;

      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gCustomProfiles[alias.toLowerCase()] = profileData; });
      }

      // Save to Netlify Blobs for cross-container and cross-restart permanent persistence
      let blobSaved = false;
      if (store) {
        try {
          if (store.setJSON) {
            await store.setJSON(cleanUuid, profileData);
            await store.setJSON(pId, profileData);
            if (pUsername) await store.setJSON(pUsername, profileData);
            if (profileData.avatar_uuid) await store.setJSON(profileData.avatar_uuid.toLowerCase().trim(), profileData);
            await store.setJSON('all_profiles', gCustomProfiles);
            blobSaved = true;
            console.log(`[SAVE_PROFILE] Blobs saved via setJSON for keys: ${cleanUuid}, ${pId}, ${pUsername}`);
          } else if (store.set) {
            const dataStr = JSON.stringify(profileData);
            await store.set(cleanUuid, dataStr);
            await store.set(pId, dataStr);
            if (pUsername) await store.set(pUsername, dataStr);
            if (profileData.avatar_uuid) await store.set(profileData.avatar_uuid.toLowerCase().trim(), dataStr);
            await store.set('all_profiles', JSON.stringify(gCustomProfiles));
            blobSaved = true;
            console.log(`[SAVE_PROFILE] Blobs saved via set for keys: ${cleanUuid}, ${pId}, ${pUsername}`);
          } else {
            console.warn('[SAVE_PROFILE] Store has no setJSON or set method. Available methods:', Object.keys(store));
          }
        } catch (blobErr) {
          lastStoreError = 'Blobs save write error: ' + blobErr.message;
          console.warn('[BLOBS STORAGE WARNING]', blobErr.message, blobErr.stack);
        }
      } else {
        console.warn('[SAVE_PROFILE] No Blobs store available - data saved to in-memory only');
      }

      // Update Tribute Goal in-memory cache if provided
      if (profileData.tribute_goal) {
        gTributeGoals[cleanUuid] = profileData.tribute_goal;
        gTributeGoals[pId] = profileData.tribute_goal;
      }

      // Include blob persistence status in response
      profileData._blob_saved = blobSaved;
      profileData._store_available = !!store;
      profileData._store_error = lastStoreError;
    }

    // Return success response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Profile / subscription / tribute update received and processed successfully.',
        timestamp: new Date().toISOString(),
        uuid: uuid,
        status: status || 'updated',
        liveStatuses: gLiveStatuses,
        subscriptions: gSubscriptions,
        tributeGoals: gTributeGoals,
        profile: profileData || gCustomProfiles[cleanUuid] || null
      })
    };
  } catch (err) {
    console.error('[DIRECTORY UPDATE ERROR]', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: err.message })
    };
  }
};
