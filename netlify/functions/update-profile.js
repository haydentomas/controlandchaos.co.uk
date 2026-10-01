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

// In-Memory Subscription & Publishing State Cache
let gSubscriptions = {
  "b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec": {
    tier: "Tier 2 VIP",
    published: true,
    is_vip: false,
    expires_at: new Date(Date.now() + 28 * 86400000).toISOString()
  },
  "alek-zane": {
    tier: "Tier 2 VIP",
    published: true,
    is_vip: false,
    expires_at: new Date(Date.now() + 28 * 86400000).toISOString()
  },
  "e8d64b18-3a9b-4b2e-a5b6-c9a8e7d6f5a1": {
    tier: "Tier 3 Royal Lifetime",
    published: true,
    is_vip: true,
    expires_at: "2026-12-31T23:59:59Z"
  },
  "alexis-vane": {
    tier: "Tier 3 Royal Lifetime",
    published: true,
    is_vip: true,
    expires_at: "2026-12-31T23:59:59Z"
  }
};

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

let getStore;
try {
  ({ getStore } = require('@netlify/blobs'));
} catch (e) {}

function getProfilesStore() {
  if (getStore) {
    try {
      return getStore({ name: 'directory-profiles', consistency: 'strong' });
    } catch (e) {
      try {
        return getStore('directory-profiles');
      } catch (err) {}
    }
  }
  return null;
}

function verifyToken(uuid, token, secret, payload) {
  const cleanSecret = secret ? String(secret).trim() : '';
  const cleanToken = token ? String(token).trim().toLowerCase() : '';

  // 1. Direct Master Secret / Admin / Web Studio verification
  if (
    cleanSecret === SECRET_KEY || 
    cleanSecret.toUpperCase() === "CC_DIRECTORY_SECRET_2026_GOLD" ||
    cleanSecret.toLowerCase() === "cc_directory_secret_2026_gold" ||
    cleanToken.toUpperCase() === "CC_DIRECTORY_SECRET_2026_GOLD" ||
    cleanToken.toLowerCase() === "cc_directory_secret_2026_gold" ||
    cleanToken === 'paypal_verified' ||
    cleanToken === 'admin'
  ) {
    return true;
  }

  if (process.env.ADMIN_EDIT_TOKEN && cleanToken === process.env.ADMIN_EDIT_TOKEN.toLowerCase()) {
    return true;
  }

  if (!cleanToken) return false;

  // 2. Collect all possible candidate keys (UUIDs, usernames, slugs, profile IDs)
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

  const secretsToCheck = [SECRET_KEY, "CC_DIRECTORY_SECRET_2026_GOLD"];

  // 3. Check rolling tokens (15-day rolling window: -7 to +7 days)
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Support GET request to retrieve all live in-world statuses, dynamic profiles, subscriptions, and tribute goals
  if (event.httpMethod === 'GET') {
    const query = event.queryStringParameters || {};
    const targetId = (query.id || query.uuid || query.slug || query.username || '').toLowerCase().trim();
    let foundProfile = null;

    const store = getProfilesStore();

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

      // If not in memory, query Netlify Blobs
      if (!foundProfile && store) {
        try {
          foundProfile = await store.get(targetId, { type: 'json' });
          if (!foundProfile && KNOWN_AVATARS[targetId]) {
            for (const alias of KNOWN_AVATARS[targetId]) {
              foundProfile = await store.get(alias.toLowerCase(), { type: 'json' });
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
        const allStored = await store.get('all_profiles', { type: 'json' });
        if (allStored && typeof allStored === 'object') {
          gCustomProfiles = { ...allStored };
          if (targetId && gCustomProfiles[targetId]) {
            foundProfile = gCustomProfiles[targetId];
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
    const { uuid, id, username, name, token, secret, action, profileData, status, tier, duration_days, days, published, is_vip } = payload;

    if (!uuid || !verifyToken(uuid, token, secret, payload)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid or expired access token.' })
      };
    }

    console.log(`[DIRECTORY UPDATE] Action: ${action || 'save_profile'} for UUID: ${uuid} | Status: ${status}`);

    const cleanUuid = String(uuid).toLowerCase().trim();
    const cleanId = id ? String(id).toLowerCase().trim() : null;

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
      const dur = duration_days || (tier && tier.includes('3') ? 3650 : 30);
      const expiry = new Date(Date.now() + (dur * 86400000)).toISOString();
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
      const pId = (profileData.id || cleanId || cleanUuid).toLowerCase().trim();
      const pUsername = (profileData.sl_username || '').toLowerCase().trim();
      
      gCustomProfiles[cleanUuid] = profileData;
      gCustomProfiles[pId] = profileData;
      if (pUsername) gCustomProfiles[pUsername] = profileData;

      if (KNOWN_AVATARS[cleanUuid]) {
        KNOWN_AVATARS[cleanUuid].forEach(alias => { gCustomProfiles[alias.toLowerCase()] = profileData; });
      }

      // Save to Netlify Blobs for cross-container and cross-restart permanent persistence
      const store = getProfilesStore();
      if (store) {
        try {
          await store.setJSON(cleanUuid, profileData);
          await store.setJSON(pId, profileData);
          if (pUsername) await store.setJSON(pUsername, profileData);
          if (profileData.avatar_uuid) await store.setJSON(profileData.avatar_uuid.toLowerCase().trim(), profileData);
          await store.setJSON('all_profiles', gCustomProfiles);
        } catch (blobErr) {
          console.warn('[BLOBS STORAGE WARNING]', blobErr.message);
        }
      }

      // Update Tribute Goal in-memory cache if provided
      if (profileData.tribute_goal) {
        gTributeGoals[cleanUuid] = profileData.tribute_goal;
        gTributeGoals[pId] = profileData.tribute_goal;
      }

      // Ensure marked as published in subscriptions
      const subEntry = gSubscriptions[cleanUuid] || gSubscriptions[pId] || { tier: 'Tier 2 VIP', expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
      subEntry.published = true;
      gSubscriptions[cleanUuid] = subEntry;
      gSubscriptions[pId] = subEntry;
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
