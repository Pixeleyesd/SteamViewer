// SteamViewer server
//
// Responsibilities:
//   1. Steam OpenID login (no password ever touches this server — Steam handles auth)
//   2. A signed, cookie-based session (no database/session store needed)
//   3. Proxy endpoints for the Steam Web API + Store API (keeps your API key secret,
//      and avoids the browser CORS restrictions on Steam's endpoints)
//
// The frontend never talks to Steam directly except for the final steam:// play link,
// which the OS handles, not this server.

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();

// --- Config -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
// PUBLIC_URL must be the externally reachable https URL of this service,
// e.g. https://steamviewer.pixeleyesd.dpdns.org
// This matters because behind a Cloudflare Tunnel, the server itself is only
// ever hit over plain http on localhost — we can't infer the public https
// origin from the request, so we pin it explicitly.
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!STEAM_API_KEY || !SESSION_SECRET || !PUBLIC_URL) {
  console.error('Missing required env vars. Check STEAM_API_KEY, SESSION_SECRET, PUBLIC_URL in .env');
  process.exit(1);
}

const COOKIE_NAME = 'steamviewer_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Trust the Cloudflare Tunnel / reverse proxy in front of us so
// req.secure / req.protocol reflect the real client connection.
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Simple in-memory cache for the Store API --------------------------
// The store API is easy to rate-limit against, especially once more than
// one person is using this. Cache app details for a while since game
// descriptions/genres/price essentially never change minute to minute.
const storeCache = new Map(); // appid -> { data, expiresAt }
const STORE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getCached(appid) {
  const entry = storeCache.get(appid);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}
function setCached(appid, data) {
  storeCache.set(appid, { data, expiresAt: Date.now() + STORE_CACHE_TTL_MS });
}

// --- Session cookie helpers ---------------------------------------------
// The cookie holds: steamid + expiry timestamp + an HMAC signature.
// A SteamID64 is not sensitive (it's public), so we don't need server-side
// session storage — just something the browser can't forge.
function signSession(steamid, expiresAt) {
  const payload = `${steamid}.${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifySession(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [steamid, expiresAtStr, hmac] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!steamid || !expiresAt || Number.isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const expectedHmac = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${steamid}.${expiresAtStr}`)
    .digest('hex');

  // Constant-time compare
  const a = Buffer.from(hmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return steamid;
}

function requireAuth(req, res, next) {
  const steamid = verifySession(req.cookies[COOKIE_NAME]);
  if (!steamid) return res.status(401).json({ error: 'Not signed in' });
  req.steamid = steamid;
  next();
}

// --- Steam OpenID login ---------------------------------------------
// Steam uses OpenID 2.0. We redirect the user to Steam, they approve,
// Steam redirects back with signed params we re-verify with Steam directly.

app.get('/auth/steam', (req, res) => {
  const returnTo = `${PUBLIC_URL}/auth/steam/callback`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': PUBLIC_URL,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
});

app.get('/auth/steam/callback', async (req, res) => {
  try {
    // Re-post the params back to Steam with mode=check_authentication.
    // Steam tells us whether the signed assertion is genuinely theirs.
    const verifyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      verifyParams.append(key, value);
    }
    verifyParams.set('openid.mode', 'check_authentication');

    const verifyResp = await fetch('https://steamcommunity.com/openid/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyParams.toString(),
    });
    const verifyText = await verifyResp.text();

    if (!verifyText.includes('is_valid:true')) {
      return res.status(401).send('Steam login could not be verified.');
    }

    // claimed_id looks like: https://steamcommunity.com/openid/id/76561198000000000
    const claimedId = req.query['openid.claimed_id'] || '';
    const match = claimedId.match(/\/id\/(\d+)$/);
    if (!match) return res.status(400).send('Could not read SteamID from response.');
    const steamid = match[1];

    const expiresAt = Date.now() + COOKIE_MAX_AGE_MS;
    const cookieValue = signSession(steamid, expiresAt);

    res.cookie(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });

    res.redirect('/');
  } catch (err) {
    console.error('Steam auth callback error:', err);
    res.status(500).send('Login failed.');
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// --- API: who am I -------------------------------------------------
app.get('/api/me', async (req, res) => {
  const steamid = verifySession(req.cookies[COOKIE_NAME]);
  if (!steamid) return res.json({ signedIn: false });

  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamid}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const player = data?.response?.players?.[0];
    res.json({
      signedIn: true,
      steamid,
      username: player?.personaname || 'Steam User',
      avatar: player?.avatarmedium || null,
    });
  } catch (err) {
    console.error('GetPlayerSummaries error:', err);
    res.json({ signedIn: true, steamid, username: 'Steam User', avatar: null });
  }
});

// --- API: owned games ------------------------------------------------
app.get('/api/games', requireAuth, async (req, res) => {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${req.steamid}&include_appinfo=1&include_played_free_games=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    const games = (data?.response?.games || []).map((g) => ({
      appid: g.appid,
      name: g.name,
      playtimeMinutes: g.playtime_forever || 0,
      // Vertical "library" cover art — the same asset Steam's own client
      // uses for its grid view. Frontend falls back gracefully if missing.
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`,
    }));
    res.json({ games });
  } catch (err) {
    console.error('GetOwnedGames error:', err);
    res.status(502).json({ error: 'Could not reach Steam.' });
  }
});

// --- API: single game details -----------------------------------------
app.get('/api/game/:appid', requireAuth, async (req, res) => {
  const appid = req.params.appid;
  if (!/^\d+$/.test(appid)) return res.status(400).json({ error: 'Invalid app id' });

  const cached = getCached(appid);
  if (cached) return res.json(cached);

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const entry = data?.[appid];

    if (!entry || !entry.success) {
      const fallback = {
        appid: Number(appid),
        name: null,
        description: 'No store details available for this title.',
        genres: [],
        price: null,
        headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      };
      setCached(appid, fallback);
      return res.json(fallback);
    }

    const d = entry.data;
    const result = {
      appid: Number(appid),
      name: d.name,
      description: d.short_description || '',
      genres: (d.genres || []).map((g) => g.description),
      price: d.is_free ? 'Free' : (d.price_overview?.final_formatted || null),
      headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    };
    setCached(appid, result);
    res.json(result);
  } catch (err) {
    console.error('appdetails error:', err);
    res.status(502).json({ error: 'Could not reach Steam store.' });
  }
});

app.listen(PORT, () => {
  console.log(`SteamViewer listening on port ${PORT} (public URL: ${PUBLIC_URL})`);
});
