# SteamViewer

Sign in with Steam, browse your library as a bookshelf, click a spine to see
box art + details, hit Play to launch the game through your local Steam client.

## How it fits together

- **Frontend** (`public/`) — plain HTML/CSS/JS, no build step, no framework.
- **Backend** (`server.js`) — small Express app that:
  - handles Steam login (OpenID — Steam authenticates the user, you never see a password)
  - signs a session cookie (no database needed)
  - proxies two Steam endpoints (`GetOwnedGames`, `appdetails`) so your API key
    never reaches the browser and you don't hit Steam's CORS wall
- **Play button** — just an `<a href="steam://rungameid/APPID">`. The browser
  hands this off to the OS, which hands it to the already-installed Steam
  client. The server is not involved in launching anything.

## 1. Get a Steam Web API key

Grab one at https://steamcommunity.com/dev/apikey (any domain name is fine
to put in that form — it's not enforced).

## 2. Configure

```bash
cd steamviewer
npm install
cp .env.example .env
```

Edit `.env`:

```
STEAM_API_KEY=<your key>
SESSION_SECRET=<generate with the command below>
PUBLIC_URL=https://steamviewer.pixeleyesd.dpdns.org
PORT=3000
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`PUBLIC_URL` matters more than it looks — Steam's OpenID login redirects
back to exactly this URL, so it has to match what Cloudflare is fronting.

## 3. Run it

```bash
npm start
```

This listens on `localhost:3000` (or whatever `PORT` you set). For it to
survive reboots/crashes, run it under something like `pm2` or a systemd
service rather than just `node server.js` in a terminal:

```bash
npm install -g pm2
pm2 start server.js --name steamviewer
pm2 save
```

## 4. Cloudflare Zero Trust / Tunnel

In your Cloudflare Zero Trust dashboard, under **Networks → Tunnels**, add a
public hostname:

- **Subdomain:** `your subdomain`
- **Domain:** `your domain`
- **Service:** `http://localhost:8111` (or your `PORT`)

No special headers are required; `app.set('trust proxy', 1)` in `server.js`
already accounts for running behind a proxy. Cloudflare terminates TLS, so
the app itself only ever needs to speak plain HTTP internally.

Once that's live, `https://steamviewer.pixeleyesd.dpdns.org` should show the
site directly.

## Notes / limitations

- **First-time Play click:** the browser will show a one-time "Open Steam?"
  confirmation the first time someone clicks a `steam://` link on their
  machine. That's the browser, not this app — after they allow it once, it
  won't ask again on that device.
- **Cover art:** uses Steam's own CDN paths for library art
  (`cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg`).
  A small number of older titles don't have this asset; the detail panel
  falls back to the store header image.
- **Rate limits:** the store API (`appdetails`) is easy to rate-limit
  against once more than a couple people are using this. `server.js`
  caches each game's details in memory for 6 hours to keep calls down —
  fine for a single-server setup, but it resets if you restart the process.
- **Multi-user:** any Steam account can sign in — there's no allowlist.
  If you want to restrict it to just you or a few friends later, that'd be
  a small check in `/auth/steam/callback` against a list of allowed
  SteamID64s.
