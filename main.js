const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// 1. Allow untrusted / self-signed / expired SSL certificates used by IPTV servers
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

// 2. Suppress noisy Chromium SSL and network handshake error output in stderr/stdout
app.commandLine.appendSwitch('log-net-log', 'NUL');
app.commandLine.appendSwitch('log-level', '3'); // 3 = FATAL only, hides all ERROR/WARNING logs

// 3. Performance & video playback switches
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');

let mainWindow;

// Cache and in-memory storage for EPG & Channel Logos:
// epgDatabase: map of normalized channel name -> array of { start: number, stop: number, title: string, desc: string }
// channelLogos: map of normalized channel name -> logo URL
let epgDatabase = new Map();
let channelLogos = new Map();
let epgStatus = 'idle'; // 'idle', 'loading', 'ready', 'error'
let epgLastUpdated = 0;

function normalizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')   // strip (anything) like (резерв), (+2), (VPN 🇷🇺), (orig)
    .replace(/\s*\[[^\]]*\]/g, '') // strip [anything] like [PL], [Geo]
    .replace(/\b(hd|fhd|sd|hevc|50fps|uhd|4k|orig|full hd)\b/gi, '')
    .replace(/[^a-zа-я0-9]/gi, '')
    .trim();
}

function parseXmltvDate(dateStr) {
  if (!dateStr) return null;
  // XMLTV format: "YYYYMMDDHHMMSS +ZZZZ" or "YYYYMMDDHHMMSS"
  const m = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return null;
  const [_, year, month, day, hour, min, sec, tz] = m;
  let iso = `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  if (tz) {
    const tzSign = tz[0];
    const tzHour = tz.slice(1, 3);
    const tzMin = tz.slice(3, 5);
    iso += `${tzSign}${tzHour}:${tzMin}`;
  } else {
    iso += 'Z';
  }
  return new Date(iso);
}

// Background EPG Loader
async function initEpgBackgroundLoader() {
  if (epgStatus === 'loading') return;
  epgStatus = 'loading';
  console.log('[EPG] Starting background EPG download and index...');

  const epgUrl = 'https://iptvx.one/epg/epg_lite.xml.gz';
  const cachePath = path.join(app.getPath('userData'), 'epg_lite.xml.gz');

  try {
    let gzBuffer;
    let needDownload = true;

    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      // If cache is less than 12 hours old, reuse
      if (Date.now() - stats.mtimeMs < 12 * 60 * 60 * 1000) {
        console.log('[EPG] Loading from local cache:', cachePath);
        gzBuffer = fs.readFileSync(cachePath);
        needDownload = false;
      }
    }

    if (needDownload) {
      console.log('[EPG] Downloading latest EPG from:', epgUrl);
      const res = await fetch(epgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 FreeTV Player' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      gzBuffer = Buffer.from(ab);
      fs.writeFileSync(cachePath, gzBuffer);
    }

    console.log('[EPG] Unpacking gzip data...');
    const unzipped = zlib.gunzipSync(gzBuffer).toString('utf-8');

    console.log('[EPG] Indexing XMLTV channels, logos and schedules...');
    const newDb = new Map();
    const newLogos = new Map();

    // 1. Build channel ID to name aliases and icons
    // <channel id="rentv"><display-name>Рен ТВ</display-name><icon src="..."/></channel>
    const channelIdToNames = new Map();
    const chRegex = /<channel id="([^"]+)">([\s\S]*?)<\/channel>/g;
    let chMatch;
    while ((chMatch = chRegex.exec(unzipped)) !== null) {
      const id = chMatch[1];
      const names = [];
      const body = chMatch[2];

      const nameRegex = /<display-name[^>]*>([^<]+)<\/display-name>/g;
      let nm;
      while ((nm = nameRegex.exec(body)) !== null) {
        names.push(normalizeName(nm[1]));
      }
      const normId = normalizeName(id);
      if (normId && !names.includes(normId)) names.push(normId);
      channelIdToNames.set(id, names);

      const iconMatch = body.match(/<icon src="([^"]+)"/);
      if (iconMatch) {
        const logoUrl = iconMatch[1];
        for (const name of names) {
          if (name && !newLogos.has(name)) {
            newLogos.set(name, logoUrl);
          }
        }
      }
    }

    // 2. Parse programmes
    const pRegex = /<programme start="([^"]+)" stop="([^"]+)" channel="([^"]+)">([\s\S]*?)<\/programme>/g;
    let pm;
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const fortyEightHoursLater = now + 48 * 60 * 60 * 1000;

    let totalProgs = 0;

    while ((pm = pRegex.exec(unzipped)) !== null) {
      const start = parseXmltvDate(pm[1]);
      const stop = parseXmltvDate(pm[2]);
      if (!start || !stop) continue;

      const startTime = start.getTime();
      const stopTime = stop.getTime();

      // Filter out programmes outside our time window to conserve memory
      if (stopTime < twentyFourHoursAgo || startTime > fortyEightHoursLater) continue;

      const chId = pm[3];
      const names = channelIdToNames.get(chId);
      if (!names || names.length === 0) continue;

      const body = pm[4];
      const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/);
      const descMatch = body.match(/<desc[^>]*>([^<]+)<\/desc>/);

      const prog = {
        start: startTime,
        stop: stopTime,
        title: titleMatch ? titleMatch[1].trim() : '',
        desc: descMatch ? descMatch[1].trim() : ''
      };

      for (const name of names) {
        if (!name) continue;
        if (!newDb.has(name)) newDb.set(name, []);
        newDb.get(name).push(prog);
      }
      totalProgs++;
    }

    // Sort programmes chronologically
    for (const [k, list] of newDb.entries()) {
      list.sort((a, b) => a.start - b.start);
    }

    epgDatabase = newDb;
    channelLogos = newLogos;
    epgStatus = 'ready';
    epgLastUpdated = Date.now();
    console.log(`[EPG] Ready! Indexed ${epgDatabase.size} channels, ${channelLogos.size} logos, and ${totalProgs} programmes.`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('epg-ready');
    }
  } catch (err) {
    epgStatus = 'error';
    console.error('[EPG] Error indexing EPG:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#070d18',
    title: 'FreeTV Player',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  // Handle certificate errors gracefully
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    callback(0); // accept certificate unconditionally
  });

  // Bypass CORS & User-Agent & Referer restrictions for IPTV streams and EPG
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    if (details.url.includes('zabava') || details.url.includes('ngenix') || details.url.includes('rt.ru') || details.url.includes('wink')) {
      ua = 'WINK/1.130.1 (AndroidTV/9) HlsWinkPlayer';
    } else if (details.url.includes('iptv2022.com') || details.url.includes('limehd')) {
      ua = '{"platform":"android","app":"limehd.ru.ctvshka","version_name":"5.1.0","version_code":"388","sdk":"34","name":"Xiaomi+13+Ultra","device_id":"a7f8e9d1c2b3a4f5","is_huawei":"0"}';
    }
    details.requestHeaders['User-Agent'] = ua;

    if (details.url.includes('thestream.cyou')) {
      details.requestHeaders['Referer'] = 'https://televizor24tochka.ru/';
      details.requestHeaders['Origin'] = 'https://televizor24tochka.ru';
    } else if (details.url.includes('rutube.ru')) {
      details.requestHeaders['Referer'] = 'https://rutube.ru/';
    } else {
      delete details.requestHeaders['Referer'];
      delete details.requestHeaders['Origin'];
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Modify response headers to allow all origins
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-headers'] = ['*'];
    responseHeaders['access-control-allow-methods'] = ['*'];
    callback({ cancel: false, responseHeaders });
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: Fetch URL or Local File
ipcMain.handle('fetch-url', async (event, url) => {
  try {
    const candidatePaths = [
      url,
      path.join(__dirname, url),
      path.join(path.dirname(process.execPath), url),
      path.join(app.getPath('userData'), url)
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const text = fs.readFileSync(p, 'utf-8');
        return { success: true, data: text };
      }
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const text = await res.text();
    return { success: true, data: text };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Get channel logo by name or tvgId from EPG database
ipcMain.handle('get-channel-logo', (event, channelName, tvgId) => {
  if (tvgId) {
    const cleanId = tvgId.toLowerCase().trim();
    if (channelLogos.has(cleanId)) return channelLogos.get(cleanId);
  }
  const norm = normalizeName(channelName);
  if (!norm) return null;
  if (channelLogos.has(norm)) return channelLogos.get(norm);
  for (const [key, logo] of channelLogos.entries()) {
    if (key.length >= 4 && (key === norm || key.startsWith(norm) || norm.startsWith(key))) {
      return logo;
    }
  }
  return null;
});

// IPC: Get all channel logos map
ipcMain.handle('get-all-channel-logos', () => {
  const obj = {};
  for (const [k, v] of channelLogos.entries()) {
    obj[k] = v;
  }
  return obj;
});

// IPC: Get EPG for a specific channel name or tvgId
ipcMain.handle('get-epg-for-channel', (event, channelName, tvgId) => {
  let programmes = null;
  let logo = null;

  // 1. Try exact tvgId match first (highest accuracy)
  if (tvgId) {
    const cleanId = tvgId.toLowerCase().trim();
    programmes = epgDatabase.get(cleanId) || null;
    logo = channelLogos.get(cleanId) || null;
  }

  // 2. Exact match on normalized channel name
  const norm = normalizeName(channelName);
  if (!programmes && norm) {
    programmes = epgDatabase.get(norm) || null;
    if (!logo) logo = channelLogos.get(norm) || null;
  }

  // 3. High-confidence prefix match (at least 5 characters and length similarity >= 80%)
  if (!programmes && norm && norm.length >= 5) {
    for (const [key, list] of epgDatabase.entries()) {
      if (key.length >= 5) {
        const ratio = Math.min(key.length, norm.length) / Math.max(key.length, norm.length);
        if (ratio >= 0.8 && (key === norm || key.startsWith(norm) || norm.startsWith(key))) {
          programmes = list;
          if (!logo) logo = channelLogos.get(key) || null;
          break;
        }
      }
    }
  }

  if (!programmes || programmes.length === 0) {
    return { current: null, next: null, logo, list: [], status: epgStatus };
  }

  const now = Date.now();
  let current = null;
  let next = null;

  for (let i = 0; i < programmes.length; i++) {
    const p = programmes[i];
    if (now >= p.start && now < p.stop) {
      current = p;
      if (i + 1 < programmes.length) {
        next = programmes[i + 1];
      }
      break;
    }
  }

  // Fallback: if not found strictly inside interval, take nearest upcoming
  if (!current) {
    for (let i = 0; i < programmes.length; i++) {
      if (programmes[i].start > now) {
        current = programmes[i];
        if (i + 1 < programmes.length) next = programmes[i + 1];
        break;
      }
    }
  }

  return {
    current,
    next,
    logo,
    list: programmes.slice(0, 10),
    status: epgStatus
  };
});

app.whenReady().then(() => {
  createWindow();
  initEpgBackgroundLoader();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
