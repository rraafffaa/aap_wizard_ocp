const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('electron');
  if (process.platform === 'darwin') {
    document.body.classList.add('electron-mac');
  }
});
