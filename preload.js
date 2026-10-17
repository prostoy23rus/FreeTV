const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
  getEpgForChannel: (channelName, tvgId) => ipcRenderer.invoke('get-epg-for-channel', channelName, tvgId),
  getChannelLogo: (channelName) => ipcRenderer.invoke('get-channel-logo', channelName),
  getAllChannelLogos: () => ipcRenderer.invoke('get-all-channel-logos'),
  onEpgReady: (callback) => ipcRenderer.on('epg-ready', () => callback())
});
