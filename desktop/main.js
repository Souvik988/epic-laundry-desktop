// Epic BOS desktop launcher.
// Self-contained: this Electron app OWNS the backend. On launch it boots the Fastify server as a
// child process (no external server, no internet required), waits for it to be healthy, then loads
// the control UI from it. On quit it terminates the child. Works the same on Windows / macOS / Linux.
//
// Dev  : server lives at ../server and runs via `tsx` (hot reload).
// Prod : server is copied to resources/server (extraResources) and runs as compiled JS (node dist/index.js).
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog, Notification } = require('electron');

// Auto-update (prod only). Wrapped so a missing update server never breaks launch.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch { autoUpdater = null; }
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const isDev = !app.isPackaged;
const PORT = Number(process.env.EPIC_PORT || 3001);
const HOST = '127.0.0.1'; // bind locally only — the app is the only consumer

// Where the server binary lives.
const serverDir = isDev
  ? path.join(__dirname, '..', 'server')
  : path.join(process.resourcesPath, 'server');

// Persist data in the OS user-data dir (outside the read-only asar), not next to the binary.
const dataFile = path.join(app.getPath('userData'), 'epic.json');

let serverProc = null;
let mainWin = null;
let tray = null;

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST,
    EPIC_DATA_FILE: dataFile,
    // In dev we want the same sandbox GSP + any user .env values to pass through.
    GSP_PROVIDER: process.env.GSP_PROVIDER || 'sandbox',
    EPIC_SUPPLIER_STATE: process.env.EPIC_SUPPLIER_STATE || '29',
  };
  const stdio = ['ignore', 'pipe', 'pipe'];
  if (isDev) {
    // Dev: run via tsx. Use a shell so `npx` resolves on Windows (no extension lookup otherwise).
    serverProc = spawn('npx tsx src/index.ts', { cwd: serverDir, env, stdio, shell: true });
  } else {
    // Prod: compiled JS is copied to resources/server.
    serverProc = spawn('node', ['dist/index.js'], { cwd: serverDir, env, stdio });
  }
  serverProc.stdout.on('data', (d) => { if (process.env.EPIC_DEBUG) process.stdout.write(`[server] ${d}`); });
  serverProc.stderr.on('data', (d) => { process.stderr.write(`[server:err] ${d}`); });
  serverProc.on('exit', (code) => { if (code && code !== 0 && !app.isQuiting) console.error(`[server] exited code ${code}`); });
}

function waitForHealth(retries = 60, delay = 500) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const req = http.get({ host: HOST, port: PORT, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (n++ >= retries) return reject(new Error('server did not become healthy'));
      setTimeout(tick, delay);
    };
    tick();
  });
}

// The bundled server's API key (guarded routes). Overridable via env for hardened deployments.
const API_KEY = process.env.EPIC_API_KEY || 'dev-key-change-me';
const backupsDir = path.join(app.getPath('userData'), 'backups');

// Minimal promise-based HTTP against the local bundled server (127.0.0.1 only).
function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: HOST, port: PORT, path: apiPath, method,
      headers: {
        'x-api-key': API_KEY,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text);
        else reject(new Error(`API ${method} ${apiPath} -> ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function nativeNotify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title: title || 'Epic BOS', body: body || '' }).show(); }
  catch { /* notifications are best-effort */ }
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-07-20T05-42-45
}

// Pull a full snapshot from the server and write it to disk (used by menu, IPC, and auto-backup).
async function writeBackupTo(filePath) {
  const snapshot = await apiRequest('GET', '/api/ops/backup');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, snapshot, 'utf8');
  return filePath;
}

async function doBackupDialog() {
  const suggested = path.join(app.getPath('documents'), `EpicBOS-backup-${tsStamp()}.json`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Backup Epic BOS data',
    defaultPath: suggested,
    filters: [{ name: 'Epic BOS Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await writeBackupTo(filePath);
  nativeNotify('Backup complete', `Saved to ${path.basename(filePath)}`);
  return { ok: true, path: filePath };
}

async function doRestoreDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    title: 'Restore Epic BOS data from backup',
    properties: ['openFile'],
    filters: [{ name: 'Epic BOS Backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'warning',
    buttons: ['Restore (replace all data)', 'Cancel'],
    defaultId: 1, cancelId: 1,
    title: 'Confirm restore',
    message: 'Restoring replaces ALL current data with the contents of this backup.',
    detail: 'A safety backup of your current data is saved automatically first. Continue?',
  });
  if (response !== 0) return { ok: false, canceled: true };
  // Safety net: snapshot current state before we overwrite it.
  try { await writeBackupTo(path.join(backupsDir, `pre-restore-${tsStamp()}.json`)); } catch { /* best effort */ }
  const raw = fs.readFileSync(filePaths[0], 'utf8');
  let db; try { db = JSON.parse(raw); } catch { throw new Error('Selected file is not valid JSON'); }
  await apiRequest('POST', '/api/ops/restore', db);
  nativeNotify('Restore complete', 'Data restored. Reloading…');
  if (mainWin) mainWin.reload();
  return { ok: true, restored: filePaths[0] };
}

// Auto-backup on quit: keep the last 10 rolling snapshots in userData/backups.
async function autoBackupOnQuit() {
  try {
    await writeBackupTo(path.join(backupsDir, `autobackup-${tsStamp()}.json`));
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('autobackup-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 10))) {
      try { fs.unlinkSync(path.join(backupsDir, f)); } catch { /* ignore */ }
    }
  } catch { /* never block quit on a backup failure */ }
}

// ---- IPC: native actions requested by the renderer (via preload bridge) ----
ipcMain.handle('epic:backup', () => doBackupDialog());
ipcMain.handle('epic:restore', () => doRestoreDialog());
ipcMain.handle('epic:open-backups', () => { fs.mkdirSync(backupsDir, { recursive: true }); return shell.openPath(backupsDir); });
ipcMain.on('epic:notify', (_e, { title, body } = {}) => nativeNotify(title, body));

ipcMain.handle('epic:export-pdf', async (_e, suggestedName) => {
  if (!mainWin) return { ok: false };
  const suggested = path.join(app.getPath('documents'), `${(suggestedName || 'EpicBOS').replace(/[^\w.-]/g, '_')}.pdf`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Export current view to PDF',
    defaultPath: suggested,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const data = await mainWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  fs.writeFileSync(filePath, data);
  nativeNotify('PDF exported', `Saved to ${path.basename(filePath)}`);
  return { ok: true, path: filePath };
});

ipcMain.handle('epic:save-file', async (_e, { content = '', suggestedName = 'export.csv', filters } = {}) => {
  const suggested = path.join(app.getPath('documents'), suggestedName.replace(/[^\w.-]/g, '_'));
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Save file',
    defaultPath: suggested,
    filters: filters || [{ name: 'CSV', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true, path: filePath };
});

// Send the loaded Laundry Desk to a specific React hash route. Legacy static ERP pages retain
// their original URLs so the existing generic surface is still reachable when needed.
function navigate(route) {
  if (!mainWin) return;
  if (route.startsWith('/ui/')) mainWin.loadURL(`http://${HOST}:${PORT}${route}`);
  else mainWin.loadURL(`http://${HOST}:${PORT}/ui/app/#${route}`);
}

// India-first application menu — mirrors the modules an Indian SME runs day to day.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const go = (route) => () => navigate(route);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Laundry Order', accelerator: 'CmdOrCtrl+N', click: go('/laundry/new-order') },
        { label: 'Store Orders', accelerator: 'CmdOrCtrl+B', click: go('/laundry/orders') },
        { type: 'separator' },
        { label: 'Backup Data…', accelerator: 'CmdOrCtrl+Shift+B', click: () => doBackupDialog().catch((e) => dialog.showErrorBox('Backup failed', String(e.message || e))) },
        { label: 'Restore Data…', click: () => doRestoreDialog().catch((e) => dialog.showErrorBox('Restore failed', String(e.message || e))) },
        { label: 'Open Backups Folder', click: () => { fs.mkdirSync(backupsDir, { recursive: true }); shell.openPath(backupsDir); } },
        { type: 'separator' },
        { label: 'Export View to PDF…', accelerator: 'CmdOrCtrl+P', click: () => ipcMain.emit('epic:export-pdf-menu') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Laundry Desk',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: go('/laundry/dashboard') },
        { label: 'Order & Billing', click: go('/laundry/new-order') },
        { label: 'Store Orders', click: go('/laundry/orders') },
        { label: 'Garments & Prices', click: go('/laundry/catalogue') },
      ],
    },
    {
      label: 'Operations',
      submenu: [
        { label: 'Inventory', click: go('/ui/inventory.html') },
        { label: 'Purchases & Payables', click: go('/ui/purchases.html') },
        { label: 'Buying & Supply Chain', click: go('/ui/buying.html') },
        { label: 'Manufacturing (BOM/MRP)', click: go('/ui/manufacturing.html') },
        { label: 'Projects & Services', click: go('/ui/projects.html') },
        { label: 'HR & Payroll', click: go('/ui/hr.html') },
      ],
    },
    {
      label: 'Finance & Compliance',
      submenu: [
        { label: 'Accounting (TB / P&L / BS)', click: go('/ui/accounting.html') },
        { label: 'GST — IRN / e-Way / IMS', accelerator: 'CmdOrCtrl+2', click: go('/ui/gst.html') },
        { label: 'Banking & Reconciliation', click: go('/ui/banking.html') },
        { label: 'Quality & Compliance (TDS/TCS)', click: go('/ui/compliance.html') },
        { label: 'Returns (Credit/Debit Note)', click: go('/ui/returns.html') },
        { label: 'Fixed Assets', click: go('/ui/assets.html') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Laundry Dashboard', accelerator: 'CmdOrCtrl+0', click: go('/laundry/dashboard') },
        { label: 'Epic AI Insights', click: go('/ui/ai.html') },
        { label: 'Operations Center', click: go('/ui/ops.html') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Epic BOS on the Web', click: () => shell.openExternal('https://updates.epicbos.app/') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Menu -> PDF export (needs a save dialog; reuse the IPC handler path).
ipcMain.on('epic:export-pdf-menu', async () => {
  try {
    const title = mainWin ? mainWin.webContents.getTitle().replace(/[^\w.-]/g, '_') : 'EpicBOS';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
      title: 'Export current view to PDF',
      defaultPath: path.join(app.getPath('documents'), `${title}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return;
    const data = await mainWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(filePath, data);
    nativeNotify('PDF exported', `Saved to ${path.basename(filePath)}`);
  } catch (e) { dialog.showErrorBox('PDF export failed', String(e.message || e)); }
});

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1366, height: 860, minWidth: 960, minHeight: 640,
    title: 'Epic Laundry', backgroundColor: '#123039', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  mainWin.loadURL(`http://${HOST}:${PORT}/ui/app/#/laundry/dashboard`);

  // External links (WhatsApp, Razorpay, GSP portals) open in the OS browser, not a new Electron window.
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://${HOST}:${PORT}`)) { e.preventDefault(); shell.openExternal(url); }
  });

  mainWin.once('ready-to-show', () => mainWin.show());
  if (process.env.EPIC_DEVTOOLS === '1') mainWin.webContents.openDevTools({ mode: 'detach' });

  mainWin.on('close', (e) => {
    // On macOS keep the app alive with the tray; hide instead of quit unless quitting.
    if (process.platform === 'darwin' && !app.isQuiting) { e.preventDefault(); mainWin.hide(); }
  });
}

function createTray() {
  // System tray with Show / Quit. (Icon is optional; without one Electron uses a default.)
  const ctx = Menu.buildFromTemplate([
    { label: 'Show Epic BOS', click: () => { mainWin.show(); mainWin.focus(); } },
    { label: 'Quit', click: () => quitApp() },
  ]);
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    tray.setToolTip('Epic BOS');
    tray.setContextMenu(ctx);
    tray.on('click', () => { mainWin.show(); mainWin.focus(); });
  } catch {
    // No icon asset: skip tray visual but keep menu semantics via app.
    app.on('browser-window-created', () => {});
  }
}

let quitting = false;
async function quitApp() {
  if (quitting) return;
  quitting = true;
  app.isQuiting = true;
  // Roll a backup while the server is still alive, then terminate it.
  await autoBackupOnQuit();
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  app.quit();
}

// Allow the renderer to request a quit (via preload bridge).
ipcMain.on('app:quit', () => quitApp());

// Single instance: a second launch focuses the running window instead of opening two backends.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForHealth();
  } catch (e) {
    dialog.showErrorBox('Epic BOS failed to start', String(e && e.message || e));
    quitApp();
    return;
  }
  createWindow();
  buildMenu();
  createTray();
  nativeNotify('Epic BOS is ready', 'Your offline business OS is running locally.');

  // Self-update: notify + auto-install on next launch (prod builds only).
  if (autoUpdater && app.isPackaged) {
    autoUpdater.autoInstallOnQuit = true;
    autoUpdater.on('update-available', () => { if (process.env.EPIC_DEBUG) console.log('[updater] update available'); });
    autoUpdater.on('update-downloaded', async () => {
      const { response } = await dialog.showMessageBox(mainWin, { type: 'info', title: 'Update ready', message: 'A new Epic BOS version is installed. Restart now?', buttons: ['Restart', 'Later'] });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') quitApp(); });
