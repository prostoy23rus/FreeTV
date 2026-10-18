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

    window.freeTV = this;

    this.initDOMElements();
    this.bindEvents();
    this.loadLogos();
    this.loadPlaylist();
  }

  initDOMElements() {
    if (window.AndroidBridge) {
      if (typeof window.AndroidBridge.isAndroidTv === 'function' && window.AndroidBridge.isAndroidTv()) {
        document.body.classList.add('is-tv');
        document.body.classList.remove('is-mobile');
      } else {
        document.body.classList.add('is-mobile');
        document.body.classList.remove('is-tv');
      }
    } else {
      document.body.classList.add('is-desktop');
    }

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
    this.categorySelectBtn = document.getElementById('categorySelectBtn');
    this.selectedCategoryLabel = document.getElementById('selectedCategoryLabel');
    this.categoryModal = document.getElementById('categoryModal');
    this.categoryModalList = document.getElementById('categoryModalList');
    this.closeCategoryModalBtn = document.getElementById('closeCategoryModalBtn');
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

    this.settingsTotalChannels = document.getElementById('settingsTotalChannels');
    this.settingsVisibleChannels = document.getElementById('settingsVisibleChannels');
    this.settingsFavCount = document.getElementById('settingsFavCount');

    this.epgBadge = document.getElementById('epgBadge');
    this.epgTitle = document.getElementById('epgTitle');
    this.epgTimeRange = document.getElementById('epgTimeRange');
    this.epgProgressWrapper = document.getElementById('epgProgressWrapper');
    this.epgProgressBar = document.getElementById('epgProgressBar');
    this.epgDesc = document.getElementById('epgDesc');
    this.epgNext = document.getElementById('epgNext');

    window.freeTV = this;
    this.onEpgReady = () => {
      console.log('[Renderer] onEpgReady triggered from Android/EPG!');
      this.refreshVisibleLogos();
      if (this.currentChannel) {
        this.fetchAndDisplayEpg(this.currentChannel);
      }
    };
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
    if (window.AndroidBridge && typeof window.AndroidBridge.getChannelLogo === 'function') {
      const bridgeLogo = window.AndroidBridge.getChannelLogo(channel.name, channel.tvgId || '');
      if (bridgeLogo) return bridgeLogo;
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
    if (this.collapseSidebarBtn) {
      this.collapseSidebarBtn.addEventListener('click', () => this.toggleSidebar(false));
    }
    if (this.expandSidebarBtn) {
      this.expandSidebarBtn.addEventListener('click', () => this.toggleSidebar(true));
    }

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
      this.clearSearch();
    });

    // Вкладки (Все, Избранное, История)
    this.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this.clearSearch();
        this.applyFilters();
      });
    });

    // Выбор категории через модальное окно (для ТВ-пульта и клика)
    if (this.categorySelectBtn) {
      this.categorySelectBtn.addEventListener('click', () => {
        this.openCategoryModal();
      });
    }

    if (this.closeCategoryModalBtn) {
      this.closeCategoryModalBtn.addEventListener('click', () => {
        this.closeCategoryModal();
      });
    }

    if (this.categoryModal) {
      this.categoryModal.addEventListener('click', (e) => {
        if (e.target === this.categoryModal) {
          this.closeCategoryModal();
        }
      });
    }

    // Выбор категории через стандартный select
    if (this.categorySelect) {
      this.categorySelect.addEventListener('change', (e) => {
        this.selectedCategory = e.target.value;
        this.updateCategoryLabel();
        this.applyFilters();
      });
    }

    // Избранное у текущего канала (если кнопка есть)
    if (this.toggleFavBtn) {
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
    }

    // PiP
    if (this.pipBtn) {
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
    }

    // Fullscreen
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTvFullscreen();
      });
    }

    this.videoContainer.addEventListener('click', () => {
      if (document.body.classList.contains('tv-fullscreen')) {
        this.toggleTvFullscreen(false);
      }
    });

    // Плавное скрытие и показ плавающих оверлеев при тапе/движении мыши
    let controlsTimer = null;
    this.playerHeader = document.querySelector('.player-header');
    this.epgBar = document.querySelector('.epg-bar');

    const showControls = () => {
      if (this.playerHeader) this.playerHeader.classList.remove('controls-hidden');
      if (this.epgBar) this.epgBar.classList.remove('controls-hidden');

      if (controlsTimer) clearTimeout(controlsTimer);
      controlsTimer = setTimeout(() => {
        if (!this.video.paused) {
          if (this.playerHeader) this.playerHeader.classList.add('controls-hidden');
          if (this.epgBar) this.epgBar.classList.add('controls-hidden');
        }
      }, 4000);
    };

    // Тап по видео переключает видимость панелей управления
    this.video.addEventListener('click', (e) => {
      const isHidden = this.playerHeader && this.playerHeader.classList.contains('controls-hidden');
      if (isHidden) {
        showControls();
      } else {
        if (controlsTimer) clearTimeout(controlsTimer);
        if (this.playerHeader) this.playerHeader.classList.add('controls-hidden');
        if (this.epgBar) this.epgBar.classList.add('controls-hidden');
      }
    });

    this.videoContainer.addEventListener('mousemove', () => {
      showControls();
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

    // Двойной клик по видео — в гориз. режиме переключение масштабирования (пропорции 16:9 / во весь экран), иначе Fullscreen
    this.video.addEventListener('dblclick', () => {
      if (window.matchMedia('(orientation: landscape)').matches) {
        const isCover = this.video.style.objectFit === 'cover';
        this.video.style.objectFit = isCover ? 'contain' : 'cover';
        this.showQuickOsd(isCover ? 'Масштаб: 16:9 (оригинал)' : 'Масштаб: Во весь экран (без полос)');
      } else if (!document.fullscreenElement) {
        this.videoContainer.requestFullscreen().catch(err => console.error(err));
      } else {
        document.exitFullscreen();
      }
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
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => {
        this.openSettingsModal();
      });
    }

    if (this.closeSettingsBtn) {
      this.closeSettingsBtn.addEventListener('click', () => {
        this.settingsModal.style.display = 'none';
      });
    }

    if (this.resetPlaylistBtn) {
      this.resetPlaylistBtn.addEventListener('click', () => {
        this.playlistUrlInput.value = DEFAULT_PLAYLIST_URL;
      });
    }

    if (this.savePlaylistBtn) {
      this.savePlaylistBtn.addEventListener('click', () => {
        const url = this.playlistUrlInput.value.trim();
        if (url) {
          this.playlistUrl = url;
          localStorage.setItem('freetv_playlist_url', url);
          this.settingsModal.style.display = 'none';
          this.showQuickOsd('Загрузка нового источника...');
          this.loadPlaylist();
        }
      });
    }

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', () => {
        this.settingsModal.style.display = 'none';
        this.showQuickOsd('🔄 Обновление плейлиста и телепрограммы...');
        this.loadPlaylist();
      });
    }

    // Навигация с пульта Android TV и клавиатуры
    this.dialBuffer = '';
    this.dialTimer = null;

    window.addEventListener('keydown', (e) => {
      // Обработка клавиш в поле ввода поиска
      if (document.activeElement === this.searchInput) {
        if (e.key === 'Escape' || e.key === 'Back' || e.key === 'GoBack') {
          e.preventDefault();
          this.clearSearch();
          document.activeElement.blur();
          this.focusCurrentOrFirstChannel();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          document.activeElement.blur();
          this.focusCurrentOrFirstChannel();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          document.activeElement.blur();
          const tab = this.sidebar.querySelector('.filter-tab.active') || this.sidebar.querySelector('.filter-tab');
          if (tab) tab.focus();
          else this.focusCurrentOrFirstChannel();
          return;
        }
        return;
      }

      if (document.activeElement === this.playlistUrlInput) {
        if (e.key === 'Escape' || e.key === 'Back') {
          document.activeElement.blur();
        }
        return;
      }

      // Клавиша F для быстрого полноэкранного режима на клавиатуре/ПК
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.toggleTvFullscreen();
        return;
      }

      // Прямой ввод цифр номера канала с пульта ДУ (0-9)
      if (/^[0-9]$/.test(e.key)) {
        this.handleTvChannelDial(e.key);
        return;
      }

      // Кнопка Menu на пульте
      if (e.key === 'm' || e.key === 'M' || e.key === 'Menu') {
        e.preventDefault();
        if (this.settingsModal && this.settingsModal.style.display !== 'none') {
          this.settingsModal.style.display = 'none';
        } else {
          this.openSettingsModal();
        }
        return;
      }

      // Медиа кнопки пульта (Play/Pause)
      if (e.key === 'MediaPlayPause' || (document.body.classList.contains('tv-fullscreen') && e.key === ' ')) {
        e.preventDefault();
        if (this.video.paused) this.video.play();
        else this.video.pause();
        return;
      }
      if (e.key === 'MediaPlay') {
        this.video.play();
        return;
      }
      if (e.key === 'MediaPause' || e.key === 'MediaStop') {
        this.video.pause();
        return;
      }

      // Свободная 2D навигация (D-Pad стрелки, ОК, Назад)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Back', 'GoBack', 'ChannelUp', 'ChannelDown', 'PageUp', 'PageDown'].includes(e.key)) {
        const handled = this.handleTvNavigation(e.key);
        if (handled) {
          e.preventDefault();
        }
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
      if (this.expandSidebarBtn) this.expandSidebarBtn.style.display = 'none';
    } else {
      this.sidebar.classList.add('collapsed');
      if (this.expandSidebarBtn) this.expandSidebarBtn.style.display = 'inline-flex';
    }
  }

  async loadPlaylist() {
    this.listStatus.style.display = 'block';
    this.listStatus.textContent = 'Загрузка и парсинг плейлиста Free TV...';
    this.channelList.innerHTML = '';

    try {
      let content = '';
      if (window.AndroidBridge && typeof window.AndroidBridge.getBundledPlaylist === 'function' && (!this.playlistUrl || this.playlistUrl.includes('freetv_playlist.m3u'))) {
        content = window.AndroidBridge.getBundledPlaylist();
      } else if (window.AndroidBridge && typeof window.AndroidBridge.fetchUrl === 'function') {
        content = window.AndroidBridge.fetchUrl(this.playlistUrl);
      } else if (window.api && window.api.fetchUrl) {
        const res = await window.api.fetchUrl(this.playlistUrl);
        if (!res.success) throw new Error(res.error);
        content = res.data;
      } else {
        const res = await fetch(this.playlistUrl);
        content = await res.text();
      }

      if (!content || !content.trim()) {
        throw new Error('Не удалось получить содержимое плейлиста');
      }

      this.channels = this.parseM3U(content);
      if (this.settingsTotalChannels) {
        this.settingsTotalChannels.textContent = this.channels.length;
      }
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

      setTimeout(() => {
        const first = this.channelList.querySelector('.channel-item');
        if (first) first.focus();
      }, 350);
    } catch (err) {
      console.error('Ошибка загрузки плейлиста:', err);
      this.listStatus.style.display = 'block';
      this.listStatus.textContent = 'Ошибка загрузки плейлиста: ' + err.message;
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
    if (this.categorySelect) {
      this.categorySelect.innerHTML = `<option value="ALL">Все категории (${this.channels.length})</option>`;
      this.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.name;
        opt.textContent = `${cat.name} (${cat.count})`;
        if (this.selectedCategory === cat.name) opt.selected = true;
        this.categorySelect.appendChild(opt);
      });
    }
    this.updateCategoryLabel();
  }

  updateCategoryLabel() {
    if (!this.selectedCategoryLabel) return;
    if (this.selectedCategory === 'ALL') {
      this.selectedCategoryLabel.textContent = `Все категории (${this.channels.length})`;
    } else {
      const found = this.categories.find(c => c.name === this.selectedCategory);
      const count = found ? found.count : 0;
      this.selectedCategoryLabel.textContent = `${this.selectedCategory} (${count})`;
    }
    if (this.categorySelect) {
      this.categorySelect.value = this.selectedCategory;
    }
  }

  openCategoryModal() {
    if (!this.categoryModal || !this.categoryModalList) return;
    this.renderCategoryModalList();
    this.categoryModal.style.display = 'flex';
    setTimeout(() => {
      const active = this.categoryModalList.querySelector('.category-modal-item.active') ||
                     this.categoryModalList.querySelector('.category-modal-item');
      if (active) {
        active.focus();
        active.scrollIntoView({ block: 'nearest' });
      }
    }, 60);
  }

  closeCategoryModal() {
    if (this.categoryModal) {
      this.categoryModal.style.display = 'none';
    }
    if (this.categorySelectBtn) {
      this.categorySelectBtn.focus();
    }
  }

  renderCategoryModalList() {
    if (!this.categoryModalList) return;
    this.categoryModalList.innerHTML = '';

    const allItem = document.createElement('button');
    const isAllActive = this.selectedCategory === 'ALL';
    allItem.className = `category-modal-item ${isAllActive ? 'active' : ''}`;
    allItem.tabIndex = 0;
    allItem.innerHTML = `
      <span class="cat-modal-name">${isAllActive ? '✓ ' : ''}Все категории</span>
      <span class="cat-modal-count">${this.channels.length}</span>
    `;
    allItem.addEventListener('click', () => {
      this.selectedCategory = 'ALL';
      this.clearSearch();
      this.updateCategoryLabel();
      this.applyFilters();
      this.closeCategoryModal();
      this.focusCurrentOrFirstChannel();
    });
    this.categoryModalList.appendChild(allItem);

    this.categories.forEach(cat => {
      const item = document.createElement('button');
      const isActive = this.selectedCategory === cat.name;
      item.className = `category-modal-item ${isActive ? 'active' : ''}`;
      item.tabIndex = 0;
      item.innerHTML = `
        <span class="cat-modal-name">${isActive ? '✓ ' : ''}${cat.name}</span>
        <span class="cat-modal-count">${cat.count}</span>
      `;
      item.addEventListener('click', () => {
        this.selectedCategory = cat.name;
        this.clearSearch();
        this.updateCategoryLabel();
        this.applyFilters();
        this.closeCategoryModal();
        this.focusCurrentOrFirstChannel();
      });
      this.categoryModalList.appendChild(item);
    });
  }

  clearSearch(apply = true) {
    if (!this.searchInput) return;
    if (this.searchInput.value) {
      this.searchInput.value = '';
      if (this.clearSearchBtn) this.clearSearchBtn.style.display = 'none';
      if (apply) {
        this.applyFilters();
      }
    }
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
    if (this.channelCountBadge) this.channelCountBadge.textContent = `${list.length} кан.`;
    if (this.settingsVisibleChannels) this.settingsVisibleChannels.textContent = list.length;
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
      item.setAttribute('tabindex', '0');

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
        <button class="channel-fav-btn ${isFav ? 'is-fav' : ''}" tabindex="0" title="${isFav ? 'Удалить из избранного' : 'В избранное'}" aria-label="Избранное">★</button>
      `;

      item.addEventListener('click', (e) => {
        const favBtn = e.target.closest('.channel-fav-btn');
        if (favBtn) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleFavorite(channel);
          const isNowFav = this.favorites.has(channel.url);
          favBtn.classList.toggle('is-fav', isNowFav);
          favBtn.title = isNowFav ? 'Удалить из избранного' : 'В избранное';
          this.showQuickOsd(isNowFav ? `★ Добавлено в избранное: ${channel.name}` : `☆ Удалено из избранного: ${channel.name}`);
          this.updateFavCount();
          this.updateFavButtonState();
          if (this.activeTab === 'fav') {
            this.applyFilters();
          } else {
            this.updateActiveItemVisuals();
          }
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
        const isFav = this.favorites.has(url);
        favBtn.classList.toggle('is-fav', isFav);
        favBtn.title = isFav ? 'Удалить из избранного' : 'В избранное';
      }
    });
  }

  playChannel(channel) {
    if (!channel || !channel.url) return;
    this.currentChannel = channel;
    localStorage.setItem('freetv_last_channel', channel.url);

    this.addToHistory(channel);

    // Сбрасываем поисковый запрос при выборе канала, чтобы не блокировать каталог
    if (this.searchInput && this.searchInput.value) {
      this.clearSearch();
    }

    // Обновляем шапку
    this.currentName.textContent = channel.name;
    this.currentCategory.textContent = channel.group || 'Прямой эфир';
    this.channelNumBadge.textContent = `№ ${channel.id}`;
    this.streamStatus.textContent = 'Подключение...';
    this.streamStatus.className = 'status-indicator';
    if (this.toggleFavBtn) {
      this.toggleFavBtn.disabled = false;
      this.updateFavButtonState();
    }

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
    if (!channel) return;

    try {
      let epg = null;

      // 1. AndroidBridge (на Android устройствах)
      if (window.AndroidBridge && typeof window.AndroidBridge.getEpgForChannel === 'function') {
        try {
          const jsonStr = window.AndroidBridge.getEpgForChannel(channel.name, channel.tvgId || '', channel.group || '');
          if (jsonStr && jsonStr.trim()) {
            const parsed = JSON.parse(jsonStr);
            if (parsed && parsed.title) {
              epg = {
                current: {
                  title: parsed.title,
                  desc: parsed.desc,
                  start: parsed.start,
                  stop: parsed.stop
                },
                next: parsed.nextTitle ? {
                  title: parsed.nextTitle,
                  start: parsed.nextStart
                } : null
              };
            }
          }
        } catch (bridgeErr) {
          console.warn('AndroidBridge EPG error:', bridgeErr);
        }
      }

      // 2. Electron IPC (на ПК)
      if (!epg && window.api && window.api.getEpgForChannel) {
        epg = await window.api.getEpgForChannel(channel.name, channel.tvgId);
      }

      // 3. Fallback умный генератор
      if (!epg || !epg.current) {
        epg = this.generateFallbackEpg(channel);
      }

      if (epg && epg.current) {
        this.currentEpgData = epg;
        this.epgTitle.textContent = epg.current.title;

        const startTime = new Date(epg.current.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const stopTime = new Date(epg.current.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.epgTimeRange.textContent = `${startTime} – ${stopTime}`;

        this.epgDesc.textContent = epg.current.desc || channel.name;

        if (epg.next && epg.next.title) {
          const nextStart = new Date(epg.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.epgNext.textContent = `Далее в ${nextStart}: ${epg.next.title}`;
        } else {
          this.epgNext.textContent = '';
        }

        this.epgProgressWrapper.style.display = 'block';
        this.updateEpgProgress();
      }
    } catch (err) {
      console.warn('EPG fetch error:', err);
    }
  }

  generateFallbackEpg(channel) {
    const now = Date.now();
    const slotMs = 45 * 60 * 1000;
    const start = now - (now % slotMs);
    const stop = start + slotMs;
    const hour = new Date().getHours();
    const group = (channel && channel.group) ? channel.group : 'Эфирные';
    const name = (channel && channel.name) ? channel.name : 'Телеканал';

    let title = 'Прямой эфир: ' + name;
    let nextTitle = 'Информационный выпуск';

    if (group.includes('Кино') || group.includes('Сериал')) {
      title = (hour >= 21 || hour < 2) ? 'Вечерний блокбастер' : (hour >= 14 ? 'Художественный фильм' : 'Телевизионный сериал');
      nextTitle = 'Художественный фильм';
    } else if (group.includes('Спорт')) {
      title = (hour >= 18 && hour < 23) ? 'Прямой эфир: Главные матчи дня' : 'Обзор спортивных событий';
      nextTitle = 'Спортивный дневник';
    } else if (group.includes('Музык')) {
      title = (hour >= 18) ? 'Вечерний хит-парад ТОП-20' : 'Музыкальный нон-стоп';
      nextTitle = 'Горячие треки';
    } else if (group.includes('Детск') || group.includes('Мульт')) {
      title = (hour >= 20) ? 'Спокойной ночи, малыши!' : 'Любимые мультфильмы';
      nextTitle = 'Мультсериал';
    } else if (group.includes('Новост')) {
      title = 'Новости: Главные события к этому часу';
      nextTitle = 'Информационный выпуск';
    } else {
      if (hour >= 6 && hour < 10) title = 'Утреннее информационно-развлекательное шоу';
      else if (hour >= 10 && hour < 14) title = 'Телевизионная программа: Специальный выпуск';
      else if (hour >= 14 && hour < 18) title = 'Дневной эфир: Документальный проект';
      else if (hour >= 18 && hour < 21) title = 'Главный вечерний выпуск новостей';
      else if (hour >= 21) title = 'Вечернее ток-шоу';
      else title = 'Ночной эфир: Лучшие передачи';
    }

    return {
      current: {
        title,
        desc: `Категория: ${group} • Прямой эфир канала ${name}`,
        start,
        stop
      },
      next: {
        title: nextTitle,
        start: stop
      }
    };
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

  toggleTvFullscreen(force) {
    const isCurrentlyFullscreen = document.body.classList.contains('tv-fullscreen');
    const shouldBeFullscreen = (force !== undefined) ? force : !isCurrentlyFullscreen;

    if (window.AndroidBridge && typeof window.AndroidBridge.setFullscreenState === 'function') {
      window.AndroidBridge.setFullscreenState(shouldBeFullscreen);
    }

    if (shouldBeFullscreen) {
      document.body.classList.add('tv-fullscreen');
      if (this.fullscreenBtn) {
        this.fullscreenBtn.querySelector('.btn-text').textContent = 'Свернуть';
        this.fullscreenBtn.querySelector('.btn-icon').textContent = '🗗';
      }
      // При входе в полный экран прячем OSD и сбрасываем поиск
      if (this.quickOsd) this.quickOsd.style.display = 'none';
      if (this.searchInput && this.searchInput.value) {
        this.clearSearch();
      }
      if (this.videoContainer) this.videoContainer.focus();
    } else {
      document.body.classList.remove('tv-fullscreen');
      if (this.fullscreenBtn) {
        this.fullscreenBtn.querySelector('.btn-text').textContent = 'Во весь экран';
        this.fullscreenBtn.querySelector('.btn-icon').textContent = '⛶';
        this.fullscreenBtn.focus();
      }
    }
  }

  handleTvNavigation(key) {
    const isFullscreen = document.body.classList.contains('tv-fullscreen');

    // ==========================================
    // 1. В РЕЖИМЕ ПОЛНОГО ЭКРАНА (tv-fullscreen)
    // ==========================================
    if (isFullscreen) {
      if (key === 'Escape' || key === 'Back' || key === 'GoBack') {
        this.toggleTvFullscreen(false);
        return true;
      }
      if (key === 'ArrowUp' || key === 'ChannelUp' || key === 'PageUp') {
        this.navigateChannels(-1);
        if (this.currentChannel) {
          this.showQuickOsd(`${this.currentChannel.id}. ${this.currentChannel.name}`);
        }
        return true;
      }
      if (key === 'ArrowDown' || key === 'ChannelDown' || key === 'PageDown') {
        this.navigateChannels(1);
        if (this.currentChannel) {
          this.showQuickOsd(`${this.currentChannel.id}. ${this.currentChannel.name}`);
        }
        return true;
      }
      if (key === 'Enter') {
        if (this.video.paused) this.video.play();
        else this.video.pause();
        return true;
      }
      return true; // В полноэкранном режиме поглощаем остальные стрелки
    }

    // ==========================================
    // 2. ЕСЛИ ОТКРЫТО МОДАЛЬНОЕ ОКНО КАТЕГОРИЙ
    // ==========================================
    if (this.categoryModal && this.categoryModal.style.display !== 'none') {
      if (key === 'Escape' || key === 'Back' || key === 'GoBack') {
        this.closeCategoryModal();
        return true;
      }
      const catItems = Array.from(this.categoryModalList.querySelectorAll('.category-modal-item'));
      if (!catItems.length) return false;
      let idx = catItems.indexOf(document.activeElement);
      if (key === 'ArrowDown') {
        idx = (idx + 1) % catItems.length;
        catItems[idx].focus();
        catItems[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return true;
      }
      if (key === 'ArrowUp') {
        idx = (idx - 1 + catItems.length) % catItems.length;
        catItems[idx].focus();
        catItems[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return true;
      }
      if (key === 'Enter') {
        if (document.activeElement && typeof document.activeElement.click === 'function') {
          document.activeElement.click();
        }
        return true;
      }
      return true;
    }

    // ==========================================
    // 3. ЕСЛИ ОТКРЫТО МОДАЛЬНОЕ ОКНО НАСТРОЕК (на ПК)
    // ==========================================
    if (this.settingsModal && this.settingsModal.style.display !== 'none') {
      if (key === 'Escape' || key === 'Back' || key === 'GoBack') {
        this.settingsModal.style.display = 'none';
        return true;
      }
      const focusables = Array.from(this.settingsModal.querySelectorAll('button, input, select')).filter(el => el.offsetParent !== null);
      if (!focusables.length) return false;
      let idx = focusables.indexOf(document.activeElement);
      if (key === 'ArrowDown' || key === 'ArrowRight') {
        idx = (idx + 1) % focusables.length;
        focusables[idx].focus();
        return true;
      }
      if (key === 'ArrowUp' || key === 'ArrowLeft') {
        idx = (idx - 1 + focusables.length) % focusables.length;
        focusables[idx].focus();
        return true;
      }
      if (key === 'Enter') {
        if (document.activeElement && typeof document.activeElement.click === 'function') {
          document.activeElement.click();
        }
        return true;
      }
      return false;
    }

    // ==========================================
    // 4. ОСНОВНОЙ ТВ-ИНТЕРФЕЙС (СВОБОДНОЕ 2D ПЕРЕМЕЩЕНИЕ)
    // ==========================================
    const activeEl = document.activeElement;
    const isChannel = activeEl && activeEl.classList.contains('channel-item');
    const isChannelFav = activeEl && activeEl.classList.contains('channel-fav-btn');
    const isFilterTab = activeEl && activeEl.classList.contains('filter-tab');
    const isCategory = activeEl === this.categorySelectBtn || activeEl === this.categorySelect;
    const isSearch = activeEl === this.searchInput;
    const isFullscreenBtn = activeEl === this.fullscreenBtn;

    // Быстрый хоткей добавления/удаления из избранного (клавиша F или 0 на пульте)
    if (key === 'f' || key === 'F' || key === '0') {
      if (isChannel) {
        const favBtn = activeEl.querySelector('.channel-fav-btn');
        if (favBtn) { favBtn.click(); return true; }
      } else if (isChannelFav) {
        activeEl.click();
        return true;
      }
    }

    // Если фокус ни на чем в приложении не стоит — фокусируем текущий или первый канал
    if (!isChannel && !isChannelFav && !isFilterTab && !isCategory && !isSearch && !isFullscreenBtn) {
      this.focusCurrentOrFirstChannel();
      return true;
    }

    // --- НАЖАТИЕ ВНИЗ ---
    if (key === 'ArrowDown') {
      if (isChannel) {
        let next = activeEl.nextElementSibling;
        while (next && !next.classList.contains('channel-item')) {
          next = next.nextElementSibling;
        }
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          const items = this.channelList.querySelectorAll('.channel-item');
          const currIdx = Array.from(items).indexOf(next);
          if (currIdx >= items.length - 8) {
            this.renderNextBatch();
          }
        }
        return true;
      }
      if (isChannelFav) {
        const parentItem = activeEl.closest('.channel-item');
        if (parentItem) {
          let next = parentItem.nextElementSibling;
          while (next && !next.classList.contains('channel-item')) {
            next = next.nextElementSibling;
          }
          if (next) {
            const nextFav = next.querySelector('.channel-fav-btn');
            if (nextFav) {
              nextFav.focus();
            } else {
              next.focus();
            }
            next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            const items = this.channelList.querySelectorAll('.channel-item');
            const currIdx = Array.from(items).indexOf(next);
            if (currIdx >= items.length - 8) {
              this.renderNextBatch();
            }
          }
        }
        return true;
      }
      if (isCategory) {
        this.focusCurrentOrFirstChannel();
        return true;
      }
      if (isFilterTab) {
        if (this.categorySelectBtn) {
          this.categorySelectBtn.focus();
        } else if (this.categorySelect) {
          this.categorySelect.focus();
        }
        return true;
      }
      if (isSearch) {
        const tab = this.sidebar.querySelector('.filter-tab.active') || this.sidebar.querySelector('.filter-tab');
        if (tab) tab.focus();
        return true;
      }
      if (isFullscreenBtn) {
        if (this.errorBanner && this.errorBanner.style.display !== 'none' && this.retryBtn) {
          this.retryBtn.focus();
        }
        return true;
      }
    }

    // --- НАЖАТИЕ ВВЕРХ ---
    if (key === 'ArrowUp') {
      if (isChannel) {
        let prev = activeEl.previousElementSibling;
        while (prev && !prev.classList.contains('channel-item')) {
          prev = prev.previousElementSibling;
        }
        if (prev) {
          prev.focus();
          prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          // Самый верх списка каналов — переходим на селектор категорий
          if (this.categorySelectBtn) {
            this.categorySelectBtn.focus();
          } else if (this.categorySelect) {
            this.categorySelect.focus();
          }
        }
        return true;
      }
      if (isChannelFav) {
        const parentItem = activeEl.closest('.channel-item');
        if (parentItem) {
          let prev = parentItem.previousElementSibling;
          while (prev && !prev.classList.contains('channel-item')) {
            prev = prev.previousElementSibling;
          }
          if (prev) {
            const prevFav = prev.querySelector('.channel-fav-btn');
            if (prevFav) {
              prevFav.focus();
            } else {
              prev.focus();
            }
            prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            if (this.categorySelectBtn) {
              this.categorySelectBtn.focus();
            } else if (this.categorySelect) {
              this.categorySelect.focus();
            }
          }
        }
        return true;
      }
      if (isCategory) {
        const tab = this.sidebar.querySelector('.filter-tab.active') || this.sidebar.querySelector('.filter-tab');
        if (tab) tab.focus();
        return true;
      }
      if (isFilterTab) {
        if (this.searchInput) this.searchInput.focus();
        return true;
      }
      if (isSearch) {
        return true; // Самый верх на ТВ
      }
      if (isFullscreenBtn) {
        if (this.searchInput) this.searchInput.focus();
        return true;
      }
    }

    // --- НАЖАТИЕ ВПРАВО ---
    if (key === 'ArrowRight') {
      if (isChannel) {
        // Переход из строки канала на его звёздочку «Избранное»
        const favBtn = activeEl.querySelector('.channel-fav-btn');
        if (favBtn) {
          favBtn.focus();
          return true;
        } else if (this.fullscreenBtn) {
          this.fullscreenBtn.focus();
          return true;
        }
      }
      if (isChannelFav || isCategory) {
        // Со звездочки или кнопки категорий переходим на «Во весь экран»
        if (this.fullscreenBtn) {
          this.fullscreenBtn.focus();
        }
        return true;
      }
      if (isFilterTab) {
        const tabs = Array.from(this.sidebar.querySelectorAll('.filter-tab'));
        const idx = tabs.indexOf(activeEl);
        if (idx >= 0 && idx < tabs.length - 1) {
          tabs[idx + 1].focus();
        } else if (this.fullscreenBtn) {
          this.fullscreenBtn.focus();
        }
        return true;
      }
      if (isSearch) {
        if (this.fullscreenBtn) this.fullscreenBtn.focus();
        return true;
      }
    }

    // --- НАЖАТИЕ ВЛЕВО ---
    if (key === 'ArrowLeft') {
      if (isFullscreenBtn) {
        // Возврат из кнопки "Во весь экран" обратно в список каналов
        this.focusCurrentOrFirstChannel();
        return true;
      }
      if (isChannelFav) {
        // Со звёздочки возвращаемся на саму строку канала
        const parentItem = activeEl.closest('.channel-item');
        if (parentItem) {
          parentItem.focus();
          return true;
        }
      }
      if (isFilterTab) {
        const tabs = Array.from(this.sidebar.querySelectorAll('.filter-tab'));
        const idx = tabs.indexOf(activeEl);
        if (idx > 0) {
          tabs[idx - 1].focus();
        }
        return true;
      }
    }

    // --- НАЖАТИЕ ОК / ENTER (ВЫБОР ДЕЙСТВИЯ) ---
    if (key === 'Enter') {
      if (activeEl && typeof activeEl.click === 'function') {
        activeEl.click();
        return true;
      }
    }

    // --- НАЖАТИЕ НАЗАД (BACK / ESCAPE) ---
    if (key === 'Escape' || key === 'Back' || key === 'GoBack') {
      if (this.categoryModal && this.categoryModal.style.display !== 'none') {
        this.closeCategoryModal();
        return true;
      }
      if (this.settingsModal && this.settingsModal.style.display !== 'none') {
        this.settingsModal.style.display = 'none';
        return true;
      }
      // Если был выполнен поиск — сбрасываем его и возвращаем полный список каналов
      if (this.searchInput && this.searchInput.value) {
        this.clearSearch();
        this.focusCurrentOrFirstChannel();
        return true;
      }
      this.focusCurrentOrFirstChannel();
      return true;
    }

    return false;
  }

  focusCurrentOrFirstChannel() {
    const active = this.channelList.querySelector('.channel-item.active') || this.channelList.querySelector('.channel-item');
    if (active) {
      active.focus();
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  navigateChannels(delta) {
    if (!this.filteredChannels.length) return;
    const currentIdx = this.filteredChannels.findIndex(c => this.currentChannel && c.url === this.currentChannel.url);
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = this.filteredChannels.length - 1;
    if (nextIdx >= this.filteredChannels.length) nextIdx = 0;
    this.playChannel(this.filteredChannels[nextIdx]);
  }

  handleTvChannelDial(digit) {
    this.dialBuffer += digit;

    let dialBadge = document.getElementById('tvChannelDial');
    if (!dialBadge) {
      dialBadge = document.createElement('div');
      dialBadge.id = 'tvChannelDial';
      dialBadge.className = 'tv-channel-dial';
      document.body.appendChild(dialBadge);
    }
    dialBadge.textContent = `[ ${this.dialBuffer} ]`;
    dialBadge.style.display = 'block';

    if (this.dialTimer) clearTimeout(this.dialTimer);
    this.dialTimer = setTimeout(() => {
      const targetNum = parseInt(this.dialBuffer, 10);
      dialBadge.style.display = 'none';
      this.dialBuffer = '';

      if (!isNaN(targetNum)) {
        // Ищем канал по номеру или порядковому индексу
        const found = this.channels.find(c => c.id === targetNum) || this.channels[targetNum - 1];
        if (found) {
          this.playChannel(found);
        }
      }
    }, 1300);
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
    if (!this.currentChannel || !this.toggleFavBtn) return;
    const isFav = this.favorites.has(this.currentChannel.url);
    this.toggleFavBtn.classList.toggle('is-fav', isFav);
    this.toggleFavBtn.title = isFav ? 'Удалить из избранного' : 'Добавить в избранное';
  }

  updateFavCount() {
    if (this.favCountSpan) this.favCountSpan.textContent = this.favorites.size;
    if (this.settingsFavCount) this.settingsFavCount.textContent = this.favorites.size;
  }

  openSettingsModal() {
    if (document.body.classList.contains('is-tv')) return;
    if (this.playlistUrlInput) this.playlistUrlInput.value = this.playlistUrl;
    if (this.settingsTotalChannels) this.settingsTotalChannels.textContent = this.channels.length;
    if (this.settingsVisibleChannels) this.settingsVisibleChannels.textContent = this.filteredChannels.length;
    if (this.settingsFavCount) this.settingsFavCount.textContent = this.favorites.size;
    if (this.settingsModal) this.settingsModal.style.display = 'flex';
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
