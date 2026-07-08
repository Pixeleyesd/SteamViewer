// SteamViewer frontend, interactive pieces are: zoom (ctrl+scroll),
// and the spine, detail panel click.

const accountEl = document.getElementById('account');
const shelfContainer = document.getElementById('shelf-container');
const shelfZoom = document.getElementById('shelf-zoom');
const shelfViewport = document.getElementById('shelf-viewport');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');

const overlay = document.getElementById('detail-overlay');
const detailClose = document.getElementById('detail-close');
const detailCover = document.getElementById('detail-cover');
const detailTitle = document.getElementById('detail-title');
const detailGenres = document.getElementById('detail-genres');
const detailDesc = document.getElementById('detail-desc');
const detailPrice = document.getElementById('detail-price');
const detailPlaytime = document.getElementById('detail-playtime');
const detailPlay = document.getElementById('detail-play');

let zoomLevel = 1;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.08;

// ---------------- Auth ----------------

async function checkSession() {
  const res = await fetch('/api/me');
  const data = await res.json();

  if (data.signedIn) {
    renderSignedInAccount(data);
    loadGames();
  } else {
    renderSignInButton();
    emptyState.hidden = false;
  }
}

function renderSignInButton() {
  accountEl.innerHTML = `<button class="btn-signin" id="signin-btn">Sign in through Steam</button>`;
  document.getElementById('signin-btn').addEventListener('click', () => {
    window.location.href = '/auth/steam';
  });
}

function renderSignedInAccount(data) {
  accountEl.innerHTML = `
    <div class="account-signed-in">
      ${data.avatar ? `<img class="account-avatar" src="${data.avatar}" alt="" />` : ''}
      <span class="account-name">${escapeHtml(data.username)}</span>
      <button class="btn-logout" id="logout-btn">Sign out</button>
    </div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  });
}

// Lib

async function loadGames() {
  emptyState.hidden = true;
  loadingState.hidden = false;

  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error('Failed to load games');
    const data = await res.json();
    loadingState.hidden = true;

    if (!data.games || data.games.length === 0) {
      emptyState.hidden = false;
      emptyState.querySelector('p').textContent = 'No games found on this Steam account.';
      return;
    }

    renderShelf(data.games);
  } catch (err) {
    loadingState.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Could not load your library. Try refreshing.';
    console.error(err);
  }
}

function renderShelf(games) {
  shelfContainer.innerHTML = '';
  // Sort alphabetically
  const sorted = [...games].sort((a, b) => a.name.localeCompare(b.name));

  for (const game of sorted) {
    const spine = document.createElement('button');
    spine.className = 'spine';
    spine.type = 'button';
    spine.style.width = `${spineWidth(game.appid, game.name)}px`;
    spine.style.background = spineColor(game.appid);
    spine.setAttribute('aria-label', game.name);
    spine.dataset.appid = game.appid;
    spine.dataset.name = game.name;
    spine.dataset.cover = game.coverUrl;

    const title = document.createElement('span');
    title.className = 'spine-title';
    title.textContent = game.name;
    spine.appendChild(title);

    spine.addEventListener('click', () => openDetail(game));
    shelfContainer.appendChild(spine);
  }
}

// Deterministic hash from an appid so the same game always gets the
// same spine width/color, but different games look naturally varied,
// like a real shelf, not a uniform grid.
function hashInt(n) {
  let h = Number(n) || 0;
  h = ((h << 13) ^ h) >>> 0;
  h = (h * 2246822519) >>> 0;
  return h;
}

function spineWidth(appid, name) {
  const h = hashInt(appid);
  // 34–68px, lightly influenced by title length so longer names
  // get a hair more room.
  const base = 34 + (h % 30);
  const nameBias = Math.min(name.length / 8, 6);
  return Math.round(base + nameBias);
}

function spineColor(appid) {
  const h = hashInt(appid);
  const hue = h % 360;
  // Muted, warm book-cloth tones, constrained saturation/lightness
  // so everything still reads as part of the same shelf.
  const sat = 30 + (h % 20);
  const light = 26 + (h % 14);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// Detail

async function openDetail(game) {
  overlay.hidden = false;
  detailTitle.textContent = game.name;
  detailCover.src = game.coverUrl;
  detailCover.alt = game.name;
  detailGenres.textContent = '';
  detailDesc.textContent = 'Loading details…';
  detailPrice.textContent = '';
  detailPlaytime.textContent = formatPlaytime(game.playtimeMinutes);
  detailPlay.href = `steam://rungameid/${game.appid}`;

  try {
    const res = await fetch(`/api/game/${game.appid}`);
    const data = await res.json();
    detailDesc.textContent = data.description || 'No description available.';
    detailGenres.textContent = (data.genres || []).join(' · ');
    detailPrice.textContent = data.price || '';
    if (data.headerImage) {
      detailCover.src = data.headerImage;
    }
  } catch (err) {
    detailDesc.textContent = 'Could not load details for this game.';
    console.error(err);
  }
}

function closeDetail() {
  overlay.hidden = true;
}

detailClose.addEventListener('click', closeDetail);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.hidden) closeDetail();
});

function formatPlaytime(minutes) {
  if (!minutes) return 'Not played yet';
  const hours = Math.round(minutes / 6) / 10; // one decimal place
  return `${hours} hrs played`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Zoom

shelfViewport.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return; // let native scroll happen
  e.preventDefault();

  const direction = e.deltaY < 0 ? 1 : -1;
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + direction * ZOOM_STEP));
  shelfZoom.style.zoom = zoomLevel;
}, { passive: false });

// init

checkSession();
