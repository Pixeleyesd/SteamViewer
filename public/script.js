// main frontend script. no animations, everything just shows/hides instantly

const accountEl = document.getElementById('account');
const toolbarEl = document.getElementById('toolbar');
const shelfContainer = document.getElementById('shelf-container');
const shelfZoom = document.getElementById('shelf-zoom');
const shelfViewport = document.getElementById('shelf-viewport');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');

const viewSelect = document.getElementById('view-select');
const sortSelect = document.getElementById('sort-select');
const filterBtn = document.getElementById('filter-btn');
const filterInput = document.getElementById('filter-input');

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

let allGames = [];
let viewMode = 'shelf'; // 'shelf' | 'list' | 'grid'
let sortMode = 'name-asc';
let filterText = '';

// login stuff

async function checkSession() {
  const res = await fetch('/api/me');
  const data = await res.json();

  if (data.signedIn) {
    renderSignedInAccount(data);
    loadGames();
  } else {
    renderSignInButton();
    toolbarEl.hidden = true;
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

// loading games

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

    allGames = data.games;
    toolbarEl.hidden = false;
    renderCurrentView();
  } catch (err) {
    loadingState.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Could not load your library. Try refreshing.';
    console.error(err);
  }
}

// view, sort, filter state

function getVisibleGames() {
  let list = allGames;

  if (filterText) {
    const t = filterText.toLowerCase();
    list = list.filter((g) => g.name.toLowerCase().includes(t));
  }

  const sorted = [...list];
  switch (sortMode) {
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'playtime-desc':
      sorted.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
      break;
    case 'playtime-asc':
      sorted.sort((a, b) => a.playtimeMinutes - b.playtimeMinutes);
      break;
    case 'name-asc':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

function renderCurrentView() {
  const games = getVisibleGames();
  shelfContainer.className = `shelf-container mode-${viewMode}`;
  shelfContainer.innerHTML = '';

  if (games.length === 0) {
    const msg = document.createElement('p');
    msg.style.padding = '20px';
    msg.style.color = 'var(--muted)';
    msg.textContent = 'No games match that filter.';
    shelfContainer.appendChild(msg);
    return;
  }

  if (viewMode === 'grid') renderGrid(games);
  else if (viewMode === 'list') renderList(games);
  else renderShelf(games);
}

viewSelect.addEventListener('change', () => {
  viewMode = viewSelect.value;
  renderCurrentView();
});

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  renderCurrentView();
});

filterBtn.addEventListener('click', () => {
  const showing = filterInput.hidden;
  filterInput.hidden = !showing;
  filterBtn.classList.toggle('active', showing);
  filterBtn.setAttribute('aria-expanded', String(showing));
  if (showing) filterInput.focus();
  else {
    filterInput.value = '';
    filterText = '';
    renderCurrentView();
  }
});

filterInput.addEventListener('input', () => {
  filterText = filterInput.value.trim();
  renderCurrentView();
});

// bookshelf view

function renderShelf(games) {
  for (const game of games) {
    const slot = document.createElement('div');
    slot.className = 'spine-slot';

    const spine = document.createElement('button');
    spine.className = 'spine';
    spine.type = 'button';
    spine.style.width = `${spineWidth(game.appid, game.name)}px`;
    spine.style.height = `${spineHeight(game.appid)}px`;
    spine.style.background = game.themeColor || fallbackColor(game.appid);
    spine.setAttribute('aria-label', game.name);

    const title = document.createElement('span');
    title.className = 'spine-title';
    title.textContent = game.name;
    spine.appendChild(title);

    spine.addEventListener('click', () => openDetail(game));
    slot.appendChild(spine);
    shelfContainer.appendChild(slot);
  }
}

// grid view

function renderGrid(games) {
  for (const game of games) {
    const item = document.createElement('button');
    item.className = 'grid-item';
    item.type = 'button';

    const img = document.createElement('img');
    img.className = 'grid-cover';
    img.src = game.coverUrl;
    img.alt = game.name;
    img.loading = 'lazy';

    const name = document.createElement('span');
    name.className = 'grid-name';
    name.textContent = game.name;

    item.appendChild(img);
    item.appendChild(name);
    item.addEventListener('click', () => openDetail(game));
    shelfContainer.appendChild(item);
  }
}

// list view

function renderList(games) {
  for (const game of games) {
    const row = document.createElement('button');
    row.className = 'list-row';
    row.type = 'button';

    const thumb = document.createElement('img');
    thumb.className = 'list-thumb';
    thumb.src = game.coverUrl;
    thumb.alt = '';
    thumb.loading = 'lazy';

    const name = document.createElement('span');
    name.className = 'list-name';
    name.textContent = game.name;

    const playtime = document.createElement('span');
    playtime.className = 'list-playtime';
    playtime.textContent = formatPlaytime(game.playtimeMinutes);

    row.appendChild(thumb);
    row.appendChild(name);
    row.appendChild(playtime);
    row.addEventListener('click', () => openDetail(game));
    shelfContainer.appendChild(row);
  }
}

// same game always looks the same, different games look different

function hashInt(n) {
  let h = Number(n) || 0;
  h = ((h << 13) ^ h) >>> 0;
  h = (h * 2246822519) >>> 0;
  return h;
}

function spineWidth(appid, name) {
  const h = hashInt(appid);
  const base = 34 + (h % 30); // 34–64px
  const nameBias = Math.min(name.length / 8, 6);
  return Math.round(base + nameBias);
}

function spineHeight(appid) {
  // different number than the width hash so they don't match
  const h = hashInt(appid * 2654435761);
  return 132 + (h % 80); // 132–212px, within --spine-slot-height (226px)
}

// backup color if the server couldn't get one from the cover art
function fallbackColor(appid) {
  const h = hashInt(appid);
  const hue = h % 360;
  const sat = 30 + (h % 20);
  const light = 26 + (h % 14);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// game details popup

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

// ctrl+scroll zooms, normal scroll just scrolls like normal

shelfViewport.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return; // let native scroll happen
  e.preventDefault();

  const direction = e.deltaY < 0 ? 1 : -1;
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + direction * ZOOM_STEP));
  shelfZoom.style.zoom = zoomLevel;
}, { passive: false });

// start

checkSession();