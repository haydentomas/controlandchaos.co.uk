const crypto = require('crypto');

// Shared Secret (Must match SECRET_KEY in CC_Directory_Kiosk.lsl)
const KIOSK_DEFAULT_SECRET = "CC_DIRECTORY_SECRET_2026_GOLD";
const SECRET_KEY = process.env.DIRECTORY_SECRET_KEY || KIOSK_DEFAULT_SECRET;
const SUBSCRIPTION_PLANS = {
  'Basic Monthly': { amount: '3.99', days: 30, is_vip: false, is_lifetime: false, plan: 'basic' },
  'VIP Monthly': { amount: '6.99', days: 30, is_vip: true, is_lifetime: false, plan: 'vip' },
  'Basic Lifetime': { amount: '29.00', days: 36500, is_vip: false, is_lifetime: true, plan: 'basic' },
  'VIP Lifetime': { amount: '49.00', days: 36500, is_vip: true, is_lifetime: true, plan: 'vip' }
};

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

  const secretsToCheck = [...new Set([SECRET_KEY, KIOSK_DEFAULT_SECRET])];

  // 4. Check rolling tokens (15-day rolling window: -7 to +7 days)
  for (const candidate of candidateKeys) {
    for (const sec of secretsToCheck) {
      // LSL llMD5String(src, 0) hashes `src:0`; retain the earlier raw form for compatibility.
      const staticInputs = [`${candidate}:${sec}:0`, `${candidate}:${sec}`];
      for (const input of staticInputs) {
        const staticHash = crypto.createHash('md5').update(input).digest('hex').toLowerCase();
        if (staticHash === cleanToken || staticHash.startsWith(cleanToken) || cleanToken.startsWith(staticHash.substring(0, 12))) {
          return true;
        }
      }

      // Check daily rolling hashes
      for (let d = currentDay - 7; d <= currentDay + 7; d++) {
        const dailyInputs = [`${candidate}:${d}:${sec}:0`, `${candidate}:${d}:${sec}`];
        for (const input of dailyInputs) {
          const fullHash = crypto.createHash('md5').update(input).digest('hex').toLowerCase();
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
  }

  return false;
}

function verifyKioskPaymentToken(uuid, tier, durationDays, paymentToken, payloadSecret) {
  const secretsToCheck = [...new Set([SECRET_KEY, KIOSK_DEFAULT_SECRET])];
  if (payloadSecret && secretsToCheck.includes(payloadSecret)) {
    return true;
  }
  if (!paymentToken) return false;
  const cleanToken = String(paymentToken).trim().toLowerCase();
  const currentDay = Math.floor(Date.now() / 86400000);
  for (const sec of secretsToCheck) {
    for (let d = currentDay - 2; d <= currentDay + 2; d++) {
      const inputs = [
        `${String(uuid || '').toLowerCase()}:paid:${tier}:${durationDays}:${d}:${sec}:0`,
        `${String(uuid || '').toLowerCase()}:paid:${tier}:${durationDays}:${d}:${sec}`,
        `${String(uuid || '')}:paid:${tier}:${durationDays}:${d}:${sec}:0`,
        `${String(uuid || '')}:paid:${tier}:${durationDays}:${d}:${sec}`
      ];
      for (const input of inputs) {
        const hash = crypto.createHash('md5').update(input).digest('hex').toLowerCase();
        if (hash === cleanToken || hash.startsWith(cleanToken) || cleanToken.startsWith(hash.substring(0, 12))) {
          return true;
        }
      }
    }
  }
  return false;
}

function isSubscriptionActive(subscription) {
  if (!subscription || subscription.published === false) return false;
  if (isLifetimeSubscription(subscription)) return true;
  const expiry = subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0;
  return Number.isFinite(expiry) && expiry > Date.now();
}

function isLifetimeSubscription(subscription) {
  if (!subscription) return false;
  if (subscription.is_lifetime === true) return true;
  const legacyTier = String(subscription.tier || '').toLowerCase();
  return subscription.is_vip === true && (legacyTier.includes('royal lifetime') || legacyTier.includes('vip lifetime'));
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

async function loadSubscriptionFor(store, uuid) {
  const key = String(uuid || '').toLowerCase().trim();
  if (!key) return null;
  if (gSubscriptions[key]) return gSubscriptions[key];
  if (!store) return null;

  try {
    let subscription = await store.get(`subscription_${key}`, { type: 'json' });
    if (!subscription) {
      const raw = await store.get(`subscription_${key}`);
      if (raw && typeof raw === 'string') subscription = JSON.parse(raw);
    }
    if (subscription && typeof subscription === 'object') {
      gSubscriptions[key] = subscription;
      return subscription;
    }
  } catch (e) {
    lastStoreError = 'Per-avatar subscription load error: ' + e.message;
  }
  return null;
}

async function persistSubscription(store, uuid, subscription) {
  if (!store) throw new Error('Subscription storage is unavailable.');
  const key = `subscription_${String(uuid).toLowerCase().trim()}`;
  if (store.setJSON) {
    await store.setJSON(key, subscription);
  } else if (store.set) {
    await store.set(key, JSON.stringify(subscription));
  } else {
    throw new Error('Subscription storage does not support writes.');
  }

  try {
    await saveSubscriptions(store);
  } catch (e) {
    lastStoreError = 'Subscription index update error: ' + e.message;
  }
}

function verifyKioskPaymentToken(uuid, tier, durationDays, paymentToken) {
  const plan = SUBSCRIPTION_PLANS[tier];
  if (!uuid || !paymentToken || !plan || Number(durationDays) !== plan.days) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(nowSeconds / 86400);
  const secretsToCheck = [...new Set([SECRET_KEY, KIOSK_DEFAULT_SECRET])];
  for (let day = currentDay - 7; day <= currentDay + 7; day++) {
    const expectedTokens = secretsToCheck.flatMap(secret => {
      const message = `${String(uuid).toLowerCase().trim()}:paid:${tier}:${durationDays}:${day}:${secret}`;
      return [message + ':0', message].map(input => crypto.createHash('md5').update(input).digest('hex').substring(0, 16));
    });
    if (expectedTokens.includes(String(paymentToken).toLowerCase().trim())) return true;
  }
  return false;
}

async function verifyPayPalOrder(orderId, tier, durationDays) {
  const expected = SUBSCRIPTION_PLANS[tier];
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
      const store = getProfilesStore(event);
      await loadSubscriptions(store);
      const subscription = await loadSubscriptionFor(store, targetId);
      const expiry = subscription && subscription.expires_at ? new Date(subscription.expires_at).getTime() : 0;
      const isLifetime = isLifetimeSubscription(subscription);
      const isVip = !!(subscription && (subscription.plan === 'vip' || subscription.is_vip === true || /vip|royal lifetime/i.test(subscription.tier || '')));
      const daysLeft = !authorized || isLifetime || !Number.isFinite(expiry) ? 0 : Math.max(0, Math.ceil((expiry - Date.now()) / 86400000));
      const active = !!(authorized && subscription && subscription.published !== false && (isLifetime || daysLeft > 0));
      return {
        statusCode: authorized ? 200 : 403,
        headers,
        body: JSON.stringify({ success: authorized, active, days_left: daysLeft, is_vip: authorized && isVip, is_lifetime: authorized && isLifetime, plan: subscription && subscription.plan || (isVip ? 'vip' : 'basic') })
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
      const subscription = await loadSubscriptionFor(store, targetId);
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

    // Always load latest all profiles from Blobs store if store is available
    if (store) {
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

    let targetSubscription = null;
    let targetDaysLeft = 0;
    let targetIsVip = false;
    let targetIsActive = false;

    if (targetId) {
      targetSubscription = await loadSubscriptionFor(store, targetId) ||
                           (foundProfile && foundProfile.avatar_uuid && await loadSubscriptionFor(store, foundProfile.avatar_uuid)) ||
                           gSubscriptions[targetId] ||
                           (foundProfile && foundProfile.avatar_uuid && gSubscriptions[foundProfile.avatar_uuid.toLowerCase()]) || null;

      if (targetSubscription) {
        targetIsVip = !!(targetSubscription.is_vip || targetSubscription.lifetime || (targetSubscription.tier && (targetSubscription.tier.includes('Lifetime') || targetSubscription.tier.includes('Royal'))));
        targetIsActive = targetIsVip || (targetSubscription.expires_at && new Date(targetSubscription.expires_at).getTime() > Date.now());
        if (targetIsVip) {
          targetDaysLeft = 36500;
        } else if (targetSubscription.expires_at) {
          targetDaysLeft = Math.max(0, Math.ceil((new Date(targetSubscription.expires_at).getTime() - Date.now()) / 86400000));
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        active: targetIsActive,
        days_left: targetDaysLeft,
        is_vip: targetIsVip,
        subscription: targetSubscription,
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
        validPaymentRegistration = verifyKioskPaymentToken(uuid, tier, duration_days, payload.payment_token, payload.secret);
      }
    }
    const isKioskSecret = payload.secret && (payload.secret === SECRET_KEY || payload.secret === KIOSK_DEFAULT_SECRET);
    const requiresAdmin = (action === 'admin_grant_time' || action === 'admin_toggle_publish' || action === 'admin_remove_profile') && !isKioskSecret;

    if (requiresAdmin && !process.env.ADMIN_EDIT_TOKEN) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'Admin actions are disabled: ADMIN_EDIT_TOKEN is not configured in the Netlify site environment.' })
      };
    }

    if (isKioskSecret ? false : requiresAdmin ? !adminAuthorized : action === 'register_paid' ? !validPaymentRegistration : !verifyToken(targetKey, token, '', payload)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: action === 'register_paid' ? 'Payment could not be verified.' : 'Unauthorized: Invalid or expired access token.' })
      };
    }

    const cleanUuid = String(targetKey).toLowerCase().trim();
    const cleanId = (id || (profileData && profileData.id)) ? String(id || profileData.id).toLowerCase().trim() : null;

    console.log(`[DIRECTORY UPDATE] Action: ${action || 'save_profile'} for UUID: ${cleanUuid} | Status: ${status}`);

    // Remove Subscriber Action
    if (action === 'remove_subscriber' || action === 'admin_remove_profile') {
      const store = getProfilesStore(event);
      const keysToDelete = new Set([cleanUuid]);
      if (cleanId) keysToDelete.add(cleanId);
      if (uuid) keysToDelete.add(String(uuid).toLowerCase().trim());
      if (id) keysToDelete.add(String(id).toLowerCase().trim());

      // Remove from memory
      keysToDelete.forEach(k => {
        delete gSubscriptions[k];
        delete gCustomProfiles[k];
        delete gLiveStatuses[k];
        delete gTributeGoals[k];
      });

      if (store) {
        try {
          for (const k of Array.from(keysToDelete)) {
            try { await store.delete(k); } catch(e) {}
            try { await store.delete('sub_' + k); } catch(e) {}
          }

          // Purge from all_profiles index
          let storedProfiles = null;
          try {
            storedProfiles = await store.get('all_profiles', { type: 'json' });
            if (!storedProfiles) {
              const raw = await store.get('all_profiles');
              if (raw && typeof raw === 'string') storedProfiles = JSON.parse(raw);
            }
          } catch(e) {}

          if (storedProfiles && typeof storedProfiles === 'object') {
            Object.keys(storedProfiles).forEach(k => {
              const p = storedProfiles[k];
              const pUuid = p && p.avatar_uuid ? String(p.avatar_uuid).toLowerCase().trim() : '';
              const pId = p && p.id ? String(p.id).toLowerCase().trim() : '';
              const pUser = p && p.sl_username ? String(p.sl_username).toLowerCase().trim() : '';
              if (keysToDelete.has(k) || keysToDelete.has(pUuid) || keysToDelete.has(pId) || keysToDelete.has(pUser)) {
                delete storedProfiles[k];
              }
            });
            await store.setJSON('all_profiles', storedProfiles);
          }

          // Purge from all_subscriptions index
          let subs = await loadSubscriptions(store);
          if (subs && typeof subs === 'object') {
            Object.keys(subs).forEach(k => {
              if (keysToDelete.has(k)) delete subs[k];
            });
            await saveSubscriptions(store, subs);
          }
        } catch (e) {
          console.error('[REMOVE SUBSCRIBER ERROR]', e);
        }
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: `Subscriber ${cleanUuid} purged successfully.` })
      };
    }

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
      const plan = SUBSCRIPTION_PLANS[tier];
      if (!plan || Number(duration_days) !== plan.days || (payload.plan && payload.plan !== plan.plan)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Unknown subscription package or duration. Select Basic Monthly, VIP Monthly, Basic Lifetime, or VIP Lifetime.' })
        };
      }
      const dur = plan.days;
      const current = await loadSubscriptionFor(store, cleanUuid);
      const currentExpiry = current && current.expires_at ? new Date(current.expires_at).getTime() : 0;
      const expiryBase = Math.max(Date.now(), Number.isFinite(currentExpiry) ? currentExpiry : 0);
      const expiry = new Date(expiryBase + (dur * 86400000)).toISOString();
      const subEntry = {
        tier: tier || 'Basic Monthly',
        plan: plan ? plan.plan : (current && current.plan) || 'basic',
        published: true,
        is_vip: plan ? plan.is_vip : !!(current && current.is_vip),
        is_lifetime: plan ? plan.is_lifetime : (current ? isLifetimeSubscription(current) : dur >= 3650),
        expires_at: plan ? (plan.is_lifetime ? null : expiry) : (dur >= 3650 ? null : expiry),
        updated_at: new Date().toISOString()
      };

      gSubscriptions[cleanUuid] = subEntry;
      if (cleanId) gSubscriptions[cleanId] = subEntry;
      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gSubscriptions[alias.toLowerCase()] = subEntry; });
      }
      await persistSubscription(store, cleanUuid, subEntry);
      if (cleanId && cleanId !== cleanUuid) {
        try {
          if (store.setJSON) await store.setJSON(`subscription_${cleanId}`, subEntry);
          else if (store.set) await store.set(`subscription_${cleanId}`, JSON.stringify(subEntry));
        } catch (e) {
          lastStoreError = 'Subscription alias persistence error: ' + e.message;
        }
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, subscription: subEntry })
      };
    }

    // 3. Admin: Grant Time
    if (action === 'admin_grant_time') {
      const store = getProfilesStore(event);
      await loadSubscriptions(store);
      const existing = (await loadSubscriptionFor(store, cleanUuid)) || gSubscriptions[cleanId] || { published: true, tier: 'Tier 1 Standard' };
      if (is_vip) {
        existing.is_vip = true;
        existing.is_lifetime = true;
        existing.plan = 'vip';
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
      await persistSubscription(store, cleanUuid, existing);
      if (cleanId && cleanId !== cleanUuid) {
        if (store.setJSON) await store.setJSON(`subscription_${cleanId}`, existing);
        else if (store.set) await store.set(`subscription_${cleanId}`, JSON.stringify(existing));
      }
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

    if (action === 'admin_remove_profile') {
      const store = getProfilesStore(event);
      if (!store) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({ error: 'Profile storage is unavailable; no profile was removed.' })
        };
      }

      let storedProfiles = await store.get('all_profiles', { type: 'json' });
      if (!storedProfiles) {
        const raw = await store.get('all_profiles');
        if (raw && typeof raw === 'string') storedProfiles = JSON.parse(raw);
      }
      if (!storedProfiles || typeof storedProfiles !== 'object') storedProfiles = {};

      const removedProfiles = new Map();
      for (const [profileKey, profile] of Object.entries(storedProfiles)) {
        if (String(profile && profile.avatar_uuid || '').toLowerCase().trim() === cleanUuid) {
          removedProfiles.set(profileKey, profile);
        }
      }
      for (const [profileKey, profile] of Object.entries(gCustomProfiles)) {
        if (String(profile && profile.avatar_uuid || '').toLowerCase().trim() === cleanUuid) {
          removedProfiles.set(profileKey, profile);
        }
      }

      const blobKeysToDelete = new Set([cleanUuid]);
      for (const [profileKey, profile] of removedProfiles) {
        delete storedProfiles[profileKey];
        delete gCustomProfiles[profileKey];
        blobKeysToDelete.add(profileKey);
        if (profile.id) blobKeysToDelete.add(String(profile.id).toLowerCase().trim());
        if (profile.slug) blobKeysToDelete.add(String(profile.slug).toLowerCase().trim());
        if (profile.sl_username) blobKeysToDelete.add(String(profile.sl_username).toLowerCase().trim());
        if (profile.avatar_uuid) blobKeysToDelete.add(String(profile.avatar_uuid).toLowerCase().trim());
      }

      for (const key of blobKeysToDelete) {
        if (key && key !== 'all_profiles' && store.delete) await store.delete(key);
      }
      const subscriptionKeys = new Set([cleanUuid, cleanId, ...((KNOWN_AVATARS[cleanUuid] || []).map(alias => alias.toLowerCase()))]);
      for (const key of subscriptionKeys) {
        if (key && store.delete) await store.delete(`subscription_${key}`);
      }
      if (store.setJSON) await store.setJSON('all_profiles', storedProfiles);
      else if (store.set) await store.set('all_profiles', JSON.stringify(storedProfiles));

      await loadSubscriptions(store);
      for (const key of [...blobKeysToDelete, ...((KNOWN_AVATARS[cleanUuid] || []).map(alias => alias.toLowerCase()))]) {
        if (key) delete gSubscriptions[key];
      }
      if (store.setJSON) await store.setJSON('all_subscriptions', gSubscriptions);
      else if (store.set) await store.set('all_subscriptions', JSON.stringify(gSubscriptions));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, removed: removedProfiles.size > 0, removed_keys: Array.from(blobKeysToDelete) })
      };
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
      const subscription = await loadSubscriptionFor(store, cleanUuid);
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
      profileData.plan = subscription && subscription.plan || (subscription && subscription.is_vip ? 'vip' : 'basic');
      profileData.is_vip = profileData.plan === 'vip';
      profileData.is_lifetime = isLifetimeSubscription(subscription);
      profileData.expires_at = subscription && subscription.expires_at;
      profileData.managed_subscription = true;
      if (profileData.plan !== 'vip') {
        profileData.booking_protocol = [];
        profileData.wishlist = [];
        profileData.social_links = [];
        profileData.reviews = [];
        profileData.hardware_compat = [];
        profileData.tribute_goal = null;
        profileData.throne_url = '';
        profileData.kofi = '';
        profileData.revolut_me = '';
        profileData.cashapp = '';
        profileData.paypal_me = '';
      }
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
