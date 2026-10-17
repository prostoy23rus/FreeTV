const fs = require('fs');

const content = fs.readFileSync('freetv_playlist.m3u', 'utf-8');
const lines = content.split('\n');

const channels = [];
let curExt = '';
for (const l of lines) {
  if (l.startsWith('#EXTINF:')) curExt = l;
  else if (l.startsWith('http') && curExt) {
    const m = curExt.match(/,(.+)$/);
    channels.push({ ext: curExt, name: m ? m[1].trim() : '', url: l.trim() });
    curExt = '';
  }
}

const federalTop20 = [
  'первый канал', 'россия 1', 'матч тв', 'нтв', 'пятый канал',
  'россия к', 'россия 24', 'карусель', 'отр', 'тв центр',
  'рен тв', 'спас', 'стс', 'домашний', 'тв-3', 'тв 3', 'пятница!', 'пятница',
  'звезда', 'мир', 'тнт', 'муз-тв', 'муз тв'
];

function getPriority(name) {
  const clean = name.toLowerCase().trim();
  for (let i = 0; i < federalTop20.length; i++) {
    if (clean === federalTop20[i]) return i;
  }
  return 1000;
}

const categoryOrder = [
  'Эфирные',
  'Кино и Сериалы',
  'Познавательные',
  'Детские',
  'Музыкальные',
  'Спортивные',
  'Новости',
  'Развлекательные',
  'Региональные'
];

function getCategoryPriority(ext) {
  const m = ext.match(/group-title="([^"]+)"/);
  const grp = m ? m[1] : '';
  const idx = categoryOrder.indexOf(grp);
  return idx !== -1 ? idx : 999;
}

channels.sort((a, b) => {
  const pA = getPriority(a.name);
  const pB = getPriority(b.name);
  if (pA < 1000 || pB < 1000) {
    return pA - pB;
  }
  const catA = getCategoryPriority(a.ext);
  const catB = getCategoryPriority(b.ext);
  if (catA !== catB) return catA - catB;

  return a.name.localeCompare(b.name, 'ru');
});

let out = '#EXTM3U url-tvg="https://iptvx.one/epg/epg_lite.xml.gz"\n\n';
for (const c of channels) {
  out += c.ext + '\n' + c.url + '\n\n';
}
fs.writeFileSync('freetv_playlist.m3u', out, 'utf-8');
console.log(`Sorted freetv_playlist.m3u cleanly! Total channels: ${channels.length}`);
