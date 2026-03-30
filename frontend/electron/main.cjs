const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

const isDev = !app.isPackaged;
const iconPng = path.join(__dirname, '../build/icon.png');
const iconPath = process.platform === 'darwin'
  ? path.join(__dirname, '../build/icon.icns')
  : iconPng;

// Set app name (shows in dock on macOS instead of "Electron")
app.name = 'AAP Wizard';
if (process.platform === 'darwin') {
  // dock.setIcon requires PNG, not icns
  try { app.dock.setIcon(iconPng); } catch (_) {}
}

// Resolve paths relative to the project root
const projectRoot = isDev
  ? path.resolve(__dirname, '..', '..')
  : path.resolve(process.resourcesPath, '..');

const backendDir = path.join(projectRoot, 'backend');

let backendProcess = null;
let backendPort = 8000;

// --- Backend Management ---

function findPython() {
  // Check for the project venv first, then system python
  const venvPaths = [
    path.join(backendDir, '.venv', 'bin', 'python3'),
    path.join(backendDir, '.venv', 'bin', 'python'),
    path.join(backendDir, '.venv', 'Scripts', 'python.exe'), // Windows
    path.join(backendDir, 'venv', 'bin', 'python3'),
    path.join(backendDir, 'venv', 'bin', 'python'),
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  // Fall back to system python
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const pythonPath = findPython();
    console.log(`[Backend] Starting with: ${pythonPath}`);
    console.log(`[Backend] Working dir: ${backendDir}`);

    const env = {
      ...process.env,
      JWT_SECRET: process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('base64url'),
      PYTHONUNBUFFERED: '1',
    };

    backendProcess = spawn(pythonPath, [
      '-m', 'uvicorn', 'app.main:app',
      '--host', '127.0.0.1',
      '--port', String(backendPort),
    ], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Backend] ${msg}`);
    });

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Backend] ${msg}`);
    });

    backendProcess.on('error', (err) => {
      console.error(`[Backend] Failed to start: ${err.message}`);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      console.log(`[Backend] Exited with code ${code}`);
      backendProcess = null;
    });

    // Wait for backend to be ready
    let attempts = 0;
    const maxAttempts = 30;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${backendPort}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log(`[Backend] Ready on port ${backendPort}`);
          resolve();
        } else if (attempts < maxAttempts) {
          setTimeout(check, 500);
        } else {
          reject(new Error('Backend health check failed'));
        }
      });
      req.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(check, 500);
        } else {
          reject(new Error('Backend did not start in time'));
        }
      });
      req.setTimeout(2000, () => req.destroy());
    };
    setTimeout(check, 1000);
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('[Backend] Stopping...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// --- Window Management ---

function findVitePort() {
  const ports = [5173, 3000, 3001, 3002, 3003, 3004, 3005, 4000];
  return new Promise((resolve) => {
    let found = false;
    let remaining = ports.length;
    ports.forEach((port) => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        if (!found && res.statusCode === 200) {
          found = true;
          resolve(port);
        }
        req.destroy();
        if (--remaining === 0 && !found) resolve(3000);
      });
      req.on('error', () => {
        if (--remaining === 0 && !found) resolve(3000);
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (--remaining === 0 && !found) resolve(3000);
      });
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AAP Wizard',
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#151515',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Clear cached web content so Electron always loads the latest build/dev assets
  if (isDev) {
    await win.webContents.session.clearCache();
    await win.webContents.session.clearStorageData({ storages: ['cachestorage'] });
  }

  win.on('page-title-updated', (e) => e.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    const port = await findVitePort();
    console.log(`[UI] Loading Vite dev server on port ${port}`);
    win.loadURL(`http://localhost:${port}`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    console.error(`[Backend] Start failed: ${err.message}`);
    dialog.showErrorBox(
      'Backend Error',
      `Could not start the backend server.\n\n` +
      `Make sure Python dependencies are installed:\n` +
      `  cd backend && pip install -r requirements.txt\n\n` +
      `Error: ${err.message}`
    );
  }
  await createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});

process.on('exit', () => {
  stopBackend();
});
