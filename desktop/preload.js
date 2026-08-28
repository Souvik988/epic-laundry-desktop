// Minimal, safe preload bridge. The renderer talks to the API over fetch on the same origin
// (the server is bundled inside this app), so this bridge exposes only non-sensitive app
// metadata plus a few native desktop actions routed through the main process over IPC.
// No Node APIs are leaked to the renderer (ADR-003): contextIsolation stays on and every
// capability below is an explicit, audited channel.
const { contextBridge, ipcRenderer } = require('electron');

function appVersion() {
  try { return require('./package.json').version; } catch { return '0.0.0'; }
}

contextBridge.exposeInMainWorld('epic', {
  platform: process.platform,           // 'win32' | 'darwin' | 'linux'
  version: appVersion(),
  isDev: !require('electron').app.isPackaged,
  quit: () => ipcRenderer.send('app:quit'),

  // --- Native desktop actions (all handled in main.js) ---
  // Save a full data backup via the OS "Save As" dialog. Returns { ok, path } or { ok:false, canceled }.
  backup: () => ipcRenderer.invoke('epic:backup'),
  // Restore from a backup file via the OS "Open" dialog (asks for confirmation in main). Returns { ok, restored }.
  restore: () => ipcRenderer.invoke('epic:restore'),
  // Print the current view to a PDF via the OS "Save As" dialog. Returns { ok, path }.
  exportPdf: (suggestedName) => ipcRenderer.invoke('epic:export-pdf', suggestedName),
  // Print an isolated, escaped HTML document through the native system dialog.
  printHtml: (html) => ipcRenderer.invoke('epic:print-html', html),
  // Save arbitrary text/CSV content to disk via the OS "Save As" dialog.
  saveFile: (opts) => ipcRenderer.invoke('epic:save-file', opts),
  // Fire an OS-level (native) notification.
  notify: (title, body) => ipcRenderer.send('epic:notify', { title, body }),
  // Open a folder/path with the OS file manager (e.g. the backups folder).
  openBackupsFolder: () => ipcRenderer.invoke('epic:open-backups'),

  // Subscribe to menu-driven navigation (File/View menu -> renderer). Returns an unsubscribe fn.
  onNavigate: (cb) => {
    const h = (_e, route) => cb(route);
    ipcRenderer.on('epic:navigate', h);
    return () => ipcRenderer.removeListener('epic:navigate', h);
  },
});
