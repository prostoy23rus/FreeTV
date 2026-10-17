// Curated FreeTV clean playlist (categorized, verified, no duplicates)
const DEFAULT_PLAYLIST_URL = 'freetv_playlist.m3u';

class FreeTVApp {
  constructor() {
    this.channels = [];
    this.filteredChannels = [];
    this.categories = [];
    this.selectedCategory = 'ALL';
    this.currentChannel = null;
    this.activeTab = 'all'; // 'all', 'fav', 'history'

    this.renderedCount = 0;
    this.PAGE_SIZE = 80;

    this.favorites = this.loadFavorites();
    this.history = this.loadHistory();

    let storedUrl = localStorage.getItem('freetv_playlist_url');
    if (!storedUrl || storedUrl.includes('Dimonovich')) {
      storedUrl = DEFAULT_PLAYLIST_URL;
      localStorage.setItem('freetv_playlist_url', DEFAULT_PLAYLIST_URL);
    }
    this.playlistUrl = storedUrl;
    this.channelLogos = new Map();

    this.hls = null;
    this.osdTimer = null;
    this.epgTimer = null;
    this.currentEpgData = null;

    this.initDOMElements();
    this.bindEvents();
    this.loadLogos();
    this.loadPlaylist();
  }

  initDOMElements() {
    this.sidebar = document.getElementById('sidebar');
    this.collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
    this.expandSidebarBtn = document.getElementById('expandSidebarBtn');

    this.video = document.getElementById('videoPlayer');
    this.videoContainer = document.getElementById('videoContainer');
    this.videoLoader = document.getElementById('videoLoader');
    this.loaderText = document.getElementById('loaderText');
    this.errorBanner = document.getElementById('errorBanner');
    this.errorText = document.getElementById('errorText');
    this.retryBtn = document.getElementById('retryBtn');
    this.quickOsd = document.getElementById('quickOsd');

    this.channelListContainer = document.getElementById('channelListContainer');
    this.channelList = document.getElementById('channelList');
    this.listStatus = document.getElementById('listStatus');
    this.categorySelect = document.getElementById('categorySelect');
    this.searchInput = document.getElementById('searchInput');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.channelCountBadge = document.getElementById('channelCountBadge');

    this.currentLogo = document.getElementById('currentLogo');
    this.currentName = document.getElementById('currentName');
    this.currentCategory = document.getElementById('currentCategory');
    this.channelNumBadge = document.getElementById('channelNumBadge');
    this.streamStatus = document.getElementById('streamStatus');
    this.toggleFavBtn = document.getElementById('toggleFavBtn');
    this.pipBtn = document.getElementById('pipBtn');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');

    this.favCountSpan = document.getElementById('favCount');
    this.filterTabs = document.querySelectorAll('.filter-tab');

    this.settingsBtn = document.getElementById('settingsBtn');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.settingsModal = document.getElementById('settingsModal');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.playlistUrlInput = document.getElementById('playlistUrlInput');
    this.savePlaylistBtn = document.getElementById('savePlaylistBtn');
    this.resetPlaylistBtn = document.getElementById('resetPlaylistBtn');

    this.epgBadge = document.getElementById('epgBadge');
    this.epgTitle = document.getElementById('epgTitle');
    this.epgTimeRange = document.getElementById('epgTimeRange');
    this.epgProgressWrapper = document.getElementById('epgProgressWrapper');
    this.epgProgressBar = document.getElementById('epgProgressBar');
    this.epgDesc = document.getElementById('epgDesc');
    this.epgNext = document.getElementById('epgNext');
  }

  normalizeName(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*\[[^\]]*\]/g, '')
      .replace(/\b(hd|fhd|sd|hevc|50fps|uhd|4k|orig|full hd)\b/gi, '')
      .replace(/[^a-zа-я0-9]/gi, '')
      .trim();
  }

  getLogoForChannel(channel) {
    if (!channel) return '';
    if (channel.logo && (channel.logo.startsWith('http://') || channel.logo.startsWith('https://'))) {
      return channel.logo;
    }
    if (!this.channelLogos || this.channelLogos.size === 0) return '';
    const norm = this.normalizeName(channel.name);
    if (!norm) return '';
    if (this.channelLogos.has(norm)) {
      return this.channelLogos.get(norm);
    }
    // Partial substring match
    for (const [key, logo] of this.channelLogos.entries()) {
      if (key.length >= 3 && (norm.includes(key) || key.includes(norm))) {
        return logo;
      }
    }
    return '';
  }

  async loadLogos() {
    if (!window.api || !window.api.getAllChannelLogos) return;
    try {
      const logosObj = await window.api.getAllChannelLogos();
      if (logosObj && Object.keys(logosObj).length > 0) {
        this.channelLogos = new Map(Object.entries(logosObj));
        console.log(`[Renderer] Loaded ${this.channelLogos.size} logos from EPG`);
        this.refreshVisibleLogos();
      }
    } catch (err) {
      console.warn('Failed to load channel logos:', err);
    }
  }

  refreshVisibleLogos() {
    const items = this.channelList.querySelectorAll('.channel-item');
    items.forEach(item => {
      const chId = parseInt(item.dataset.channelId, 10);
      const channel = this.channels[chId - 1];
      if (!channel) return;
      const logo = this.getLogoForChannel(channel);
      if (logo) {
        const thumbBox = item.querySelector('.channel-thumb-box');
        if (thumbBox && !thumbBox.querySelector('img')) {
          thumbBox.innerHTML = `<img class="channel-thumb" src="${logo}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'channel-emoji\\'>📺</span>'">`;
        }
      }
    });
    if (this.currentChannel) {
      this.updateHeaderLogo(this.currentChannel);
    }
  }

  updateHeaderLogo(channel) {
    if (!channel) return;
    const logo = this.getLogoForChannel(channel);
    if (logo) {
      this.currentLogo.src = logo;
      this.currentLogo.style.display = 'block';
      this.currentLogo.onerror = () => {
        this.currentLogo.style.display = 'none';
      };
    } else {
      this.currentLogo.style.display = 'none';
    }
  }

  bindEvents() {
    // Сворачивание / разворачивание боковой панели
    this.collapseSidebarBtn.addEventListener('click', () => this.toggleSidebar(false));
    this.expandSidebarBtn.addEventListener('click', () => this.toggleSidebar(true));

    // Слушатель готовности фонового EPG
    if (window.api && window.api.onEpgReady) {
      window.api.onEpgReady(async () => {
        console.log('[Renderer] EPG background index ready! Refreshing schedules & logos...');
        await this.loadLogos();
        if (this.currentChannel) {
          this.fetchAndDisplayEpg(this.currentChannel);
        }
      });
    }

    // Поиск
    this.searchInput.addEventListener('input', () => {
      this.clearSearchBtn.style.display = this.searchInput.value ? 'block' : 'none';
      this.applyFilters();
    });

    this.clearSearchBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.clearSearchBtn.style.display = 'none';
      this.applyFilters();
    });

    // Вкладки (Все, Избранное, История)
    this.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this.applyFilters();
      });
    });

    // Выбор категории
    this.categorySelect.addEventListener('change', (e) => {
      this.selectedCategory = e.target.value;
      this.applyFilters();
    });

    // Избранное у текущего канала
    this.toggleFavBtn.addEventListener('click', () => {
      if (!this.currentChannel) return;
      this.toggleFavorite(this.currentChannel);
      this.updateFavButtonState();
      this.updateFavCount();
      if (this.activeTab === 'fav') {
        this.applyFilters();
      } else {
        this.updateActiveItemVisuals();
      }
    });

    // PiP
    this.pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && this.video) {
          await this.video.requestPictureInPicture();
        }
      } catch (e) {
        console.error('PiP error:', e);
      }
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.videoContainer.requestFullscreen().catch(err => console.error(err));
      } else {
        document.exitFullscreen();
      }
    });

    // Клик по видео ставит на паузу / пуск
    this.video.addEventListener('click', () => {
      if (this.video.paused) this.video.play();
      else this.video.pause();
    });

    this.video.addEventListener('playing', () => {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      this.hideLoader();
      this.streamStatus.textContent = '● В ЭФИРЕ';
      this.streamStatus.className = 'status-indicator live';
    });

    this.video.addEventListener('waiting', () => {
      if (this.streamStatus.textContent === '● В ЭФИРЕ') {
        this.streamStatus.textContent = 'Буферизация...';
        this.streamStatus.className = 'status-indicator';
      }
    });

    // Двойной клик по видео — полноэкранный режим
    this.video.addEventListener('dblclick', () => {
      this.fullscreenBtn.click();
    });

    // Бесконечный скролл (Infinite Scroll) списка каналов
    this.channelListContainer.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.channelListContainer;
      if (scrollTop + clientHeight >= scrollHeight - 300) {
        this.renderNextBatch();
      }
    });

    // Retry
    this.retryBtn.addEventListener('click', () => {
      if (this.currentChannel) {
        this.playChannel(this.currentChannel);
      }
    });

    // Settings Modal
    this.settingsBtn.addEventListener('click', () => {
      this.playlistUrlInput.value = this.playlistUrl;
      this.settingsModal.style.display = 'flex';
    });

    this.closeSettingsBtn.addEventListener('click', () => {
      this.settingsModal.style.display = 'none';
    });

    this.resetPlaylistBtn.addEventListener('click', () => {
      this.playlistUrlInput.value = DEFAULT_PLAYLIST_URL;
    });

    this.savePlaylistBtn.addEventListener('click', () => {
      const url = this.playlistUrlInput.value.trim();
      if (url) {
        this.playlistUrl = url;
        localStorage.setItem('freetv_playlist_url', url);
        this.settingsModal.style.display = 'none';
        this.loadPlaylist();
      }
    });

    this.refreshBtn.addEventListener('click', () => {
      this.loadPlaylist();
    });

    // Клавиатурная навигация
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === this.searchInput || document.activeElement === this.playlistUrlInput) {
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateChannels(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'f' || e.key === 'F') {
        this.fullscreenBtn.click();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (this.video.paused) this.video.play();
        else this.video.pause();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        this.toggleSidebar(this.sidebar.classList.contains('collapsed'));
      }
    });

    // Обновление прогресс-бара передачи каждую минуту
    setInterval(() => {
      this.updateEpgProgress();
    }, 30000);
  }

  toggleSidebar(open) {
    if (open) {
      this.sidebar.classList.remove('collapsed');
      this.expandSidebarBtn.style.display = 'none';
    } else {
      this.sidebar.classList.add('collapsed');
      this.expandSidebarBtn.style.display = 'inline-flex';
    }
  }

  async loadPlaylist() {
    this.listStatus.style.display = 'block';
    this.listStatus.textContent = 'Загрузка и парсинг плейлиста Free TV...';
    this.channelList.innerHTML = '';

    try {
      let content = '';
      if (window.api && window.api.fetchUrl) {
        const res = await window.api.fetchUrl(this.playlistUrl);
        if (!res.success) throw new Error(res.error);
        content = res.data;
      } else {
        const res = await fetch(this.playlistUrl);
        content = await res.text();
      }

      this.channels = this.parseM3U(content);
      this.extractCategories();
      this.populateCategoryDropdown();
      this.updateFavCount();
      this.applyFilters();
      this.loadLogos();

      this.listStatus.style.display = 'none';

      // Выбор сохраненного канала или первого в списке
      if (this.channels.length > 0 && !this.currentChannel) {
        const lastChannelUrl = localStorage.getItem('freetv_last_channel');
        const candidate = this.channels.find(c => c.url === lastChannelUrl) || this.channels[0];
        this.playChannel(candidate);
      }
    } catch (err) {
      console.error('Playlist load error:', err);
      this.listStatus.style.display = 'block';
      this.listStatus.textContent = `Ошибка загрузки плейлиста: ${err.message}`;
    }
  }

  parseM3U(data) {
    const lines = data.split('\n');
    const channels = [];
    let currentItem = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentItem = {
          name: 'Без названия',
          group: 'Общие',
          logo: '',
          tvgId: '',
          url: ''
        };

        const groupMatch = line.match(/group-title="([^"]+)"/i);
        if (groupMatch) currentItem.group = groupMatch[1].trim();

        const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
        if (logoMatch) currentItem.logo = logoMatch[1].trim();

        const idMatch = line.match(/tvg-id="([^"]+)"/i);
        if (idMatch) currentItem.tvgId = idMatch[1].trim();

        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) {
          currentItem.name = line.substring(commaIdx + 1).trim();
        }
      } else if (!line.startsWith('#') && currentItem) {
        currentItem.url = line;
        // Фильтруем информационные баннеры-заставки от реальных каналов
        const isInfoBanner = currentItem.group.includes('INFO') || currentItem.name.includes('Обновление:');
        if (!isInfoBanner && (line.startsWith('http://') || line.startsWith('https://'))) {
          currentItem.id = channels.length + 1;
          channels.push(currentItem);
        }
        currentItem = null;
      }
    }

    return channels;
  }

  extractCategories() {
    const categoryOrder = [
      'Эфирные',
      'Кино и Сериалы',
      'Познавательные',
      'Детские',
      'Музыкальные',
      'Новости',
      'Спортивные',
      'Развлекательные',
      'Региональные',
      'Релакс'
    ];
    const catMap = new Map();
    this.channels.forEach(c => {
      const g = c.group || 'Разное';
      catMap.set(g, (catMap.get(g) || 0) + 1);
    });
    this.categories = Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const idxA = categoryOrder.indexOf(a.name);
        const idxB = categoryOrder.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name, 'ru');
      });
  }

  populateCategoryDropdown() {
    this.categorySelect.innerHTML = `<option value="ALL">Все категории (${this.channels.length})</option>`;
    this.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.name;
      opt.textContent = `${cat.name} (${cat.count})`;
      if (this.selectedCategory === cat.name) opt.selected = true;
      this.categorySelect.appendChild(opt);
    });
  }

  applyFilters() {
    const query = this.searchInput.value.toLowerCase().trim();

    let list = this.channels;

    if (this.activeTab === 'fav') {
      list = list.filter(c => this.favorites.has(c.url));
    } else if (this.activeTab === 'history') {
      const historyUrls = new Map(this.history.map((h, i) => [h.url, i]));
      list = list.filter(c => historyUrls.has(c.url)).sort((a, b) => historyUrls.get(a.url) - historyUrls.get(b.url));
    }

    if (this.selectedCategory !== 'ALL' && this.activeTab === 'all') {
      list = list.filter(c => c.group === this.selectedCategory);
    }

    if (query) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(query) ||
        (c.group && c.group.toLowerCase().includes(query))
      );
    }

    this.filteredChannels = list;
    this.channelCountBadge.textContent = `${list.length} кан.`;
    this.resetAndRenderChannels();
  }

  resetAndRenderChannels() {
    this.channelList.innerHTML = '';
    this.renderedCount = 0;
    this.channelListContainer.scrollTop = 0;

    if (this.filteredChannels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-status';
      empty.textContent = 'Каналы не найдены';
      this.channelList.appendChild(empty);
      return;
    }

    this.renderNextBatch();
  }

  renderNextBatch() {
    if (this.renderedCount >= this.filteredChannels.length) return;

    const nextBatch = this.filteredChannels.slice(this.renderedCount, this.renderedCount + this.PAGE_SIZE);
    const fragment = document.createDocumentFragment();

    nextBatch.forEach(channel => {
      const item = document.createElement('div');
      const isActive = this.currentChannel && this.currentChannel.url === channel.url;
      item.className = `channel-item ${isActive ? 'active' : ''}`;
      item.dataset.url = channel.url;
      item.dataset.channelId = channel.id;

      const isFav = this.favorites.has(channel.url);
      const logo = this.getLogoForChannel(channel);

      item.innerHTML = `
        <span class="channel-num">${channel.id}</span>
        <div class="channel-thumb-box">
          ${logo ? `<img class="channel-thumb" src="${logo}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'channel-emoji\\'>📺</span>'">` : `<span class="channel-emoji">📺</span>`}
        </div>
        <div class="channel-info">
          <div class="channel-title" title="${channel.name}">${channel.name}</div>
          <div class="channel-group-tag">${channel.group}</div>
        </div>
        <button class="channel-fav-btn ${isFav ? 'is-fav' : ''}" title="${isFav ? 'Удалить из избранного' : 'В избранное'}">★</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('channel-fav-btn')) {
          e.stopPropagation();
          this.toggleFavorite(channel);
          this.updateFavCount();
          this.updateFavButtonState();
          if (this.activeTab === 'fav') this.applyFilters();
          else this.updateActiveItemVisuals();
          return;
        }
        this.playChannel(channel);
      });

      fragment.appendChild(item);
    });

    this.channelList.appendChild(fragment);
    this.renderedCount += nextBatch.length;
  }

  updateActiveItemVisuals() {
    const items = this.channelList.querySelectorAll('.channel-item');
    items.forEach(el => {
      const url = el.dataset.url;
      const isActive = this.currentChannel && this.currentChannel.url === url;
      el.classList.toggle('active', isActive);

      const favBtn = el.querySelector('.channel-fav-btn');
      if (favBtn) {
        favBtn.classList.toggle('is-fav', this.favorites.has(url));
      }
    });
  }

  playChannel(channel) {
    if (!channel || !channel.url) return;
    this.currentChannel = channel;
    localStorage.setItem('freetv_last_channel', channel.url);

    this.addToHistory(channel);

    // Обновляем шапку
    this.currentName.textContent = channel.name;
    this.currentCategory.textContent = channel.group || 'Прямой эфир';
    this.channelNumBadge.textContent = `№ ${channel.id}`;
    this.streamStatus.textContent = 'Подключение...';
    this.streamStatus.className = 'status-indicator';
    this.toggleFavBtn.disabled = false;
    this.updateFavButtonState();

    this.updateHeaderLogo(channel);

    // Загружаем и отображаем EPG (телепрограмму)
    this.fetchAndDisplayEpg(channel);

    // Быстрый OSD титр на видео
    this.showQuickOsd(`${channel.id}. ${channel.name}`);

    // Визуальная подсветка активного канала
    this.updateActiveItemVisuals();

    // Запуск потока
    this.loadStream(channel.url);
  }

  async fetchAndDisplayEpg(channel) {
    // Временная заглушка пока EPG индексируется
    this.epgTitle.textContent = channel.name;
    this.epgTimeRange.textContent = '';
    this.epgProgressWrapper.style.display = 'none';
    this.epgDesc.textContent = `Категория: ${channel.group}`;
    this.epgNext.textContent = '';

    if (!window.api || !window.api.getEpgForChannel) return;

    try {
      const epg = await window.api.getEpgForChannel(channel.name, channel.tvgId);
      if (epg && epg.logo && (!this.currentLogo.src || this.currentLogo.style.display === 'none')) {
        this.currentLogo.src = epg.logo;
        this.currentLogo.style.display = 'block';
      }
      if (epg && epg.current) {
        this.currentEpgData = epg;
        this.epgTitle.textContent = epg.current.title;

        const startTime = new Date(epg.current.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const stopTime = new Date(epg.current.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.epgTimeRange.textContent = `${startTime} – ${stopTime}`;

        this.epgDesc.textContent = epg.current.desc || channel.name;

        if (epg.next) {
          const nextStart = new Date(epg.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.epgNext.textContent = `| Далее в ${nextStart}: ${epg.next.title}`;
        } else {
          this.epgNext.textContent = '';
        }

        this.epgProgressWrapper.style.display = 'block';
        this.updateEpgProgress();
      } else {
        this.currentEpgData = null;
        this.epgTitle.textContent = channel.name;
        this.epgTimeRange.textContent = 'Прямой эфир';
        this.epgDesc.textContent = `Категория: ${channel.group} | Круглосуточное вещание`;
        this.epgNext.textContent = '';
        this.epgProgressWrapper.style.display = 'none';
      }
    } catch (err) {
      console.warn('EPG fetch error:', err);
    }
  }

  updateEpgProgress() {
    if (!this.currentEpgData || !this.currentEpgData.current) return;
    const now = Date.now();
    const { start, stop } = this.currentEpgData.current;
    if (stop <= start) return;

    const percent = Math.min(100, Math.max(0, ((now - start) / (stop - start)) * 100));
    this.epgProgressBar.style.width = `${percent.toFixed(1)}%`;
  }

  loadStream(url) {
    this.showLoader('Подключение к потоку...');
    this.hideError();

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    this.connectionTimer = setTimeout(() => {
      if (this.streamStatus.textContent !== '● В ЭФИРЕ') {
        this.showError('Поток временно недоступен или сервер не отвечает');
      }
    }, 12000);

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const isHls = url.includes('.m3u8') || url.includes('live') || url.includes('stream') || !url.endsWith('.mp4');

    if (Hls.isSupported() && isHls) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 45,
        maxMaxBufferLength: 90,
        maxBufferSize: 80 * 1000 * 1000,
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 3,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 10,
        enableSoftwareAES: true,
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
        fragLoadingTimeOut: 20000
      });

      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.showLoader('Буферизация потока...');
        this.video.muted = false;
        this.video.play().catch(e => {
          console.log('Autoplay handled, retrying unmuted:', e);
          this.video.muted = true;
          this.video.play().then(() => {
            this.video.muted = false;
          }).catch(err => console.log('Playback error:', err));
        });
      });

      let networkRetryCount = 0;
      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('HLS fatal error:', data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              networkRetryCount++;
              if (networkRetryCount <= 2) {
                console.log(`[HLS] Network error, retry #${networkRetryCount}...`);
                this.hls.startLoad();
              } else {
                console.warn('[HLS] Max network retries reached');
                this.showError('Поток временно недоступен или сервер не отвечает');
                this.hls.destroy();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Media error, recovering...');
              this.hls.recoverMediaError();
              break;
            default:
              this.showError('Поток временно недоступен или сервер не отвечает');
              this.hls.destroy();
              break;
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          if (this.video && !this.video.paused) {
            this.video.currentTime += 0.2;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl') || !isHls) {
      this.video.src = url;
      this.video.addEventListener('loadedmetadata', () => {
        this.hideLoader();
        this.streamStatus.textContent = '● В ЭФИРЕ';
        this.streamStatus.className = 'status-indicator live';
        this.video.play().catch(e => console.log(e));
      }, { once: true });

      this.video.addEventListener('error', () => {
        this.showError('Ошибка воспроизведения видео');
      }, { once: true });
    }
  }

  showQuickOsd(text) {
    if (this.osdTimer) clearTimeout(this.osdTimer);
    this.quickOsd.textContent = text;
    this.quickOsd.style.display = 'block';
    this.osdTimer = setTimeout(() => {
      this.quickOsd.style.display = 'none';
    }, 3000);
  }

  showLoader(text) {
    this.loaderText.textContent = text;
    this.videoLoader.style.display = 'flex';
  }

  hideLoader() {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    this.videoLoader.style.display = 'none';
  }

  showError(msg) {
    this.hideLoader();
    this.streamStatus.textContent = 'Ошибка';
    this.streamStatus.className = 'status-indicator';
    this.errorText.textContent = msg;
    this.errorBanner.style.display = 'flex';
  }

  hideError() {
    this.errorBanner.style.display = 'none';
  }

  navigateChannels(delta) {
    if (!this.filteredChannels.length) return;
    const currentIdx = this.filteredChannels.findIndex(c => this.currentChannel && c.url === this.currentChannel.url);
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = this.filteredChannels.length - 1;
    if (nextIdx >= this.filteredChannels.length) nextIdx = 0;
    this.playChannel(this.filteredChannels[nextIdx]);
  }

  // Избранное
  loadFavorites() {
    try {
      const data = localStorage.getItem('freetv_favorites');
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  }

  saveFavorites() {
    localStorage.setItem('freetv_favorites', JSON.stringify(Array.from(this.favorites)));
  }

  toggleFavorite(channel) {
    if (this.favorites.has(channel.url)) {
      this.favorites.delete(channel.url);
    } else {
      this.favorites.add(channel.url);
    }
    this.saveFavorites();
  }

  updateFavButtonState() {
    if (!this.currentChannel) return;
    const isFav = this.favorites.has(this.currentChannel.url);
    this.toggleFavBtn.classList.toggle('is-fav', isFav);
    this.toggleFavBtn.title = isFav ? 'Удалить из избранного' : 'Добавить в избранное';
  }

  updateFavCount() {
    this.favCountSpan.textContent = this.favorites.size;
  }

  // История
  loadHistory() {
    try {
      const data = localStorage.getItem('freetv_history');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  addToHistory(channel) {
    this.history = this.history.filter(h => h.url !== channel.url);
    this.history.unshift({ url: channel.url, name: channel.name, time: Date.now() });
    if (this.history.length > 50) this.history.pop();
    localStorage.setItem('freetv_history', JSON.stringify(this.history));
  }
}

// Запуск
document.addEventListener('DOMContentLoaded', () => {
  window.freeTV = new FreeTVApp();
});
