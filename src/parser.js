const fs = require('fs');
const path = require('path');

/**
 * Interface Channel {
 *   id: string;
 *   name: string;
 *   group: string;
 *   logo: string;
 *   url: string;
 *   tvgId: string;
 * }
 */

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let currentChannel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentChannel = {
        id: '',
        name: '',
        group: 'Разное',
        logo: '',
        url: '',
        tvgId: ''
      };

      // Extract attributes
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) currentChannel.group = groupMatch[1].trim();

      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) currentChannel.logo = logoMatch[1].trim();

      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      if (idMatch) currentChannel.tvgId = idMatch[1].trim();

      // Channel name is after the last comma
      const commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) {
        currentChannel.name = line.substring(commaIdx + 1).trim();
      } else {
        currentChannel.name = 'Без названия';
      }
    } else if (line.startsWith('#')) {
      // Other metadata/tags, ignore for basic stream url
      continue;
    } else if (currentChannel) {
      // This is the stream URL
      currentChannel.url = line;
      currentChannel.id = 'ch_' + channels.length;
      channels.push(currentChannel);
      currentChannel = null;
    }
  }

  return channels;
}

module.exports = {
  parseM3U
};
