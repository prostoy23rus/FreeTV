// State management
let allChannels = [];
let filteredChannels = [];
let favorites = new Set(JSON.parse(localStorage.getItem('freetv_favs') || '[]'));
let currentGroup = 'all';
let currentChannel = null;
let hlsInstance = null;

// DOM Elements
const video = document.getElementById('video-player');
const channelsGrid = document.getElementById('channels-grid');
const categoriesList = document.getElementById('categories-list');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const currentTitle = document.getElementById('current-title');
const currentGroupEl = document.getElementById('current-group');
const currentLogo = document.getElementById('current-logo');
const playerStatus = document.getElementById('player-status');
const channelCountBadge = document.getElementById('channel-count');
const allCountBadge = document.getElementById('all-count');
const favCountBadge = document.getElementById('fav-count');
const filteredCountBadge = document.getElementById('filtered-count');
const sectionTitle = document.getElementById('section-title');
const btnFavToggle = document.getElementById('btn-fav-toggle');
const btnPip = document.getElementById('btn-pip');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnReload = document.getElementById('btn-reload');

// Initialization
async function init() {
  setupEventListeners();
  loadPlaylist();
}

function showStatus(text) {
  if (text) {
    playerStatus.textContent = text;
    playerStatus.classList.remove('hidden');
  } else {
    playerStatus.classList.add('hidden');
  }
}

async function loadPlaylist() {
  showStatus('Загрузка плейлиста...');
  try {
    const res = await window.api.loadDefaultPlaylist();
    if (!res.success) {
      showStatus('Ошибка загрузки: ' + res.error);
      return;
    }

    allChannels = res.channels;
    channelCountBadge.textContent = `${allChannels.length} каналов`;
    allCountBadge.textContent = allChannels.length;
    favCountBadge.textContent = favorites.size;

    renderCategories();
    applyFilter();
    showStatus('');

    // Auto-play first available channel if not playing
    if (allChannels.length > 0 && !currentChannel) {
      playChannel(allChannels[0]);
    }
  } catch (err) {
    showStatus('Ошибка: ' + err.message);
  }
}

function renderCategories() {
  const groups = new Map();
  allChannels.forEach(ch => {
    const grp = ch.group || 'Разное';
    groups.set(grp, (groups.get(grp) || 0) + 1);
  });

  // Preserve 'all' and 'favorites'
  const fragment = document.createDocumentFragment();

  // All
  const liAll = document.createElement('li');
  liAll.className = currentGroup === 'all' ? 'active' : '';
  liAll.dataset.group = 'all';
  liAll.innerHTML = `<span class="icon">📺</span><span class="title">Все каналы</span><span class="count">${allChannels.length}</span>`;
  fragment.appendChild(liAll);

  // Favorites
  const liFav = document.createElement('li');
  liFav.className = currentGroup === 'favorites' ? 'active' : '';
  liFav.dataset.group = 'favorites';
  liFav.innerHTML = `<span class="icon">⭐</span><span class="title">Избранное</span><span class="count">${favorites.size}</span>`;
  fragment.appendChild(liFav);

  // Sorted group list
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
  for (const [groupName, count] of sortedGroups) {
    const li = document.createElement('li');
    li.className = currentGroup === groupName ? 'active' : '';
    li.dataset.group = groupName;
    li.innerHTML = `<span class="icon">📁</span><span class="title">${groupName}</span><span class="count">${count}</span>`;
    fragment.appendChild(li);
  }

  categoriesList.innerHTML = '';
  categoriesList.appendChild(fragment);
}

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  
  filteredChannels = allChannels.filter(ch => {
    // Category filter
    if (currentGroup === 'favorites') {
      if (!favorites.has(ch.id)) return false;
    } else if (currentGroup !== 'all') {
      if (ch.group !== currentGroup) return false;
    }

    // Search query filter
    if (query) {
      const matchName = ch.name.toLowerCase().includes(query);
      const matchGroup = (ch.group || '').toLowerCase().includes(query);
      return matchName || matchGroup;
    }

    return true;
  });

  filteredCountBadge.textContent = filteredChannels.length;
  if (currentGroup === 'all') sectionTitle.textContent = 'Все каналы';
  else if (currentGroup === 'favorites') sectionTitle.textContent = 'Избранное';
  else sectionTitle.textContent = currentGroup;

  renderChannelsList();
}

function renderChannelsList() {
  channelsGrid.innerHTML = '';
  
  if (filteredChannels.length === 0) {
    channelsGrid.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">Каналы не найдены</div>';
    return;
  }

  // Render first 200 items for smooth DOM performance
  const limit = Math.min(filteredChannels.length, 300);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < limit; i++) {
    const ch = filteredChannels[i];
    const card = document.createElement('div');
    card.className = 'channel-card' + (currentChannel && currentChannel.id === ch.id ? ' active' : '');
    card.title = ch.name;

    const logoHtml = ch.logo 
      ? `<img src="${ch.logo}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none;">📺</span>` 
      : `<span>📺</span>`;

    card.innerHTML = `
      <div class="channel-thumb">${logoHtml}</div>
      <div class="channel-details">
        <div class="channel-name">${ch.name}</div>
        <div class="channel-group-tag">${ch.group || 'ТВ'}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      playChannel(ch);
    });

    fragment.appendChild(card);
  }

  channelsGrid.appendChild(fragment);
}

function playChannel(ch) {
  currentChannel = ch;
  currentTitle.textContent = ch.name;
  currentGroupEl.textContent = ch.group || '';

  if (ch.logo) {
    currentLogo.src = ch.logo;
    currentLogo.classList.remove('hidden');
  } else {
    currentLogo.classList.add('hidden');
  }

  updateFavButton();
  showStatus('Подключение к потоку...');

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  const streamUrl = ch.url;

  if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('m3u') || !streamUrl.includes('.mp4'))) {
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 4
    });

    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(video);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      showStatus('');
      video.play().catch(e => console.log('Autoplay prevent:', e));
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showStatus('Ошибка сети при загрузке потока');
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            showStatus('Ошибка декодирования потока');
            hlsInstance.recoverMediaError();
            break;
          default:
            showStatus('Не удалось воспроизвести поток');
            hlsInstance.destroy();
            break;
        }
      }
    });
  } else {
    // Native HTML5 video fallback
    video.src = streamUrl;
    video.play().then(() => {
      showStatus('');
    }).catch(() => {
      showStatus('Ошибка воспроизведения видео');
    });
  }
}

function toggleFavorite() {
  if (!currentChannel) return;
  if (favorites.has(currentChannel.id)) {
    favorites.delete(currentChannel.id);
  } else {
    favorites.add(currentChannel.id);
  }
  localStorage.setItem('freetv_favs', JSON.stringify(Array.from(favorites)));
  favCountBadge.textContent = favorites.size;
  updateFavButton();
  if (currentGroup === 'favorites') applyFilter();
}

function updateFavButton() {
  if (!currentChannel) return;
  const isFav = favorites.has(currentChannel.id);
  btnFavToggle.textContent = isFav ? '⭐' : '☆';
  btnFavToggle.title = isFav ? 'Удалить из избранного' : 'Добавить в избранное';
}

function setupEventListeners() {
  // Category selection
  categoriesList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    document.querySelectorAll('#categories-list li').forEach(item => item.classList.remove('active'));
    li.classList.add('active');
    currentGroup = li.dataset.group;
    applyFilter();
  });

  // Search input
  searchInput.addEventListener('input', () => {
    applyFilter();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    applyFilter();
  });

  // Controls
  btnFavToggle.addEventListener('click', toggleFavorite);

  btnPip.addEventListener('click', async () => {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
    }
  });

  btnFullscreen.addEventListener('click', () => {
    const container = document.getElementById('player-container');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  });

  btnReload.addEventListener('click', loadPlaylist);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === searchInput) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (video.paused) video.play();
      else video.pause();
    } else if (e.key === 'f') {
      btnFullscreen.click();
    } else if (e.key === 'm') {
      video.muted = !video.muted;
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
