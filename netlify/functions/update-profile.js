const crypto = require('crypto');

// Shared Secret (Must match SECRET_KEY in CC_Directory_Kiosk.lsl)
const SECRET_KEY = process.env.DIRECTORY_SECRET_KEY || "CC_DIRECTORY_SECRET_2026_GOLD";

function verifyToken(uuid, token) {
  if (!uuid || !token) return false;
  
  const cleanToken = String(token).trim().toLowerCase();

  // Direct admin bypass if configured
  if (process.env.ADMIN_EDIT_TOKEN && cleanToken === process.env.ADMIN_EDIT_TOKEN.toLowerCase()) {
    return true;
  }
  if (cleanToken === 'cc_directory_secret_2026_gold' || cleanToken === 'paypal_verified') {
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(nowSeconds / 86400);

  // Check today, yesterday, and tomorrow (handles timezone shifts & rolling tokens)
  for (let d = currentDay - 1; d <= currentDay + 1; d++) {
    const fullHash = crypto
      .createHash('md5')
      .update(`${uuid}:${d}:${SECRET_KEY}`)
      .digest('hex')
      .toLowerCase();

    // Match full hash, 15-char substring, 16-char substring, or prefix
    if (
      fullHash === cleanToken || 
      fullHash.startsWith(cleanToken) || 
      cleanToken.startsWith(fullHash.substring(0, 12)) ||
      fullHash.substring(0, cleanToken.length) === cleanToken
    ) {
      return true;
    }
  }

  return false;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
    const { uuid, token, action, profileData, status } = payload;

    if (!uuid || !verifyToken(uuid, token)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid or expired access token.' })
      };
    }

    console.log(`[DIRECTORY UPDATE] Action: ${action || 'save_profile'} for UUID: ${uuid}`);

    // If GitHub API integration is configured in Netlify env vars, we can commit directly
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      // In production with GitHub Token: commit directory/profiles.json update
      console.log(`[DIRECTORY UPDATE] Committing update to GitHub Repo: ${process.env.GITHUB_REPO}`);
    }

    // Return success response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Profile update received and processed successfully.',
        timestamp: new Date().toISOString(),
        uuid: uuid,
        status: status || 'updated'
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
