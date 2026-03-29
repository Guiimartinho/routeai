// RouteAI EDA - Electron Main Process
// Creates the desktop application shell, manages the Python backend,
// and provides native OS integration (menus, dialogs, Ollama detection).

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  nativeTheme,
} = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let mainWindow = null;
let backendProcess = null;
let ollamaAvailable = false;

const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:3000';
const BACKEND_PORT = 8000;
const OLLAMA_URL = 'http://localhost:11434';

// Paths
const ROOT_DIR = isDev
  ? path.resolve(__dirname, '..', '..')
  : path.resolve(process.resourcesPath);
const SERVER_SCRIPT = isDev
  ? path.join(ROOT_DIR, 'server.py')
  : path.join(ROOT_DIR, 'backend', 'server.py');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PRELOAD = path.join(__dirname, 'preload.js');

// ---------------------------------------------------------------------------
// Ollama detection
// ---------------------------------------------------------------------------
function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get(OLLAMA_URL, { timeout: 2000 }, (res) => {
      ollamaAvailable = res.statusCode === 200;
      res.resume();
      resolve(ollamaAvailable);
    });
    req.on('error', () => {
      ollamaAvailable = false;
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      ollamaAvailable = false;
      resolve(false);
    });
  });
}

function updateTitle() {
  if (!mainWindow) return;
  const ollamaStatus = ollamaAvailable ? 'Ollama Connected' : 'Ollama Offline';
  mainWindow.setTitle(`RouteAI EDA  |  ${ollamaStatus}`);
}

// Poll Ollama status every 10 seconds
let ollamaInterval = null;
function startOllamaPolling() {
  const poll = async () => {
    await checkOllama();
    updateTitle();
  };
  poll();
  ollamaInterval = setInterval(poll, 10_000);
}

// ---------------------------------------------------------------------------
// Python backend management
// ---------------------------------------------------------------------------
function findPython() {
  // In packaged builds the bundled Python is under resources/python
  if (!isDev) {
    const bundled = path.join(process.resourcesPath, 'python', 'python3');
    if (fs.existsSync(bundled)) return bundled;
    const bundledWin = path.join(process.resourcesPath, 'python', 'python.exe');
    if (fs.existsSync(bundledWin)) return bundledWin;
  }
  // Development: use system Python (poetry environment expected)
  return process.platform === 'win32' ? 'python' : 'python3';
}

function waitForBackend(port, retries = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${port}/docs`, { timeout: 1000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        attempts++;
        if (attempts >= retries) {
          reject(new Error(`Backend did not start after ${retries} attempts`));
        } else {
          setTimeout(check, interval);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        attempts++;
        if (attempts >= retries) {
          reject(new Error('Backend start timeout'));
        } else {
          setTimeout(check, interval);
        }
      });
    };
    check();
  });
}

function startBackend() {
  const python = findPython();
  console.log(`[RouteAI] Starting backend: ${python} ${SERVER_SCRIPT}`);

  const env = { ...process.env };
  // Ensure the backend binds to localhost only
  env.HOST = '127.0.0.1';
  env.PORT = String(BACKEND_PORT);

  const cwd = isDev ? ROOT_DIR : path.dirname(SERVER_SCRIPT);

  backendProcess = spawn(python, [SERVER_SCRIPT], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // On Windows, spawn in a new process group so we can kill the tree
    ...(process.platform === 'win32' ? { detached: false } : {}),
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trimEnd()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend] ${data.toString().trimEnd()}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`[RouteAI] Backend exited with code ${code}`);
    backendProcess = null;
  });

  backendProcess.on('error', (err) => {
    console.error('[RouteAI] Failed to start backend:', err.message);
    backendProcess = null;
  });

  return waitForBackend(BACKEND_PORT);
}

function killBackend() {
  if (!backendProcess) return;
  console.log('[RouteAI] Stopping backend...');
  try {
    if (process.platform === 'win32') {
      // Kill the process tree on Windows
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
      // Force kill after 3 seconds if still alive
      setTimeout(() => {
        if (backendProcess) {
          try { backendProcess.kill('SIGKILL'); } catch (_) { /* already dead */ }
        }
      }, 3000);
    }
  } catch (err) {
    console.error('[RouteAI] Error killing backend:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleFileOpen(),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => handleFileSaveAs(),
        },
        { type: 'separator' },
        {
          label: 'Import KiCad File...',
          click: () => handleImport('kicad'),
        },
        {
          label: 'Import Eagle File...',
          click: () => handleImport('eagle'),
        },
        { type: 'separator' },
        {
          label: 'Export Gerber...',
          click: () => mainWindow?.webContents.send('menu:export', 'gerber'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            nativeTheme.themeSource =
              nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
          },
        },
      ],
    },
    // Tools
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Run DRC',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu:tool', 'drc'),
        },
        {
          label: 'Auto-Route',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu:tool', 'autoroute'),
        },
        {
          label: 'AI Design Review',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu:tool', 'ai-review'),
        },
        { type: 'separator' },
        {
          label: 'Ollama Status',
          click: async () => {
            await checkOllama();
            updateTitle();
            dialog.showMessageBox(mainWindow, {
              type: ollamaAvailable ? 'info' : 'warning',
              title: 'Ollama Status',
              message: ollamaAvailable
                ? 'Ollama is running and available at localhost:11434.'
                : 'Ollama is not detected. Install Ollama for local AI inference.',
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
      ],
    },
    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://routeai.dev/docs'),
        },
        {
          label: 'Report Issue',
          click: () =>
            shell.openExternal('https://github.com/routeai/routeai-eda/issues'),
        },
        { type: 'separator' },
        {
          label: 'About RouteAI EDA',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About RouteAI EDA',
              message: `RouteAI EDA v${app.getVersion()}`,
              detail:
                'AI-Powered PCB Design Tool\n\n' +
                'Built with Electron, React, FastAPI, and Claude AI.\n' +
                `Ollama: ${ollamaAvailable ? 'Connected' : 'Not detected'}\n` +
                `Node: ${process.versions.node}\n` +
                `Electron: ${process.versions.electron}\n` +
                `Chrome: ${process.versions.chrome}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC Handlers — native file dialogs
// ---------------------------------------------------------------------------
async function handleFileOpen() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project',
    filters: [
      { name: 'RouteAI Projects', extensions: ['routeai', 'json'] },
      { name: 'KiCad Files', extensions: ['kicad_pcb', 'kicad_sch', 'kicad_pro'] },
      { name: 'Eagle Files', extensions: ['brd', 'sch'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow?.webContents.send('file:opened', result.filePaths[0]);
  }
  return result;
}

async function handleFileSaveAs() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Project As',
    filters: [
      { name: 'RouteAI Project', extensions: ['routeai'] },
      { name: 'JSON', extensions: ['json'] },
    ],
  });

  if (!result.canceled && result.filePath) {
    mainWindow?.webContents.send('file:save-path', result.filePath);
  }
  return result;
}

async function handleImport(format) {
  const filters =
    format === 'kicad'
      ? [{ name: 'KiCad Files', extensions: ['kicad_pcb', 'kicad_sch'] }]
      : [{ name: 'Eagle Files', extensions: ['brd', 'sch'] }];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Import ${format === 'kicad' ? 'KiCad' : 'Eagle'} File`,
    filters,
    properties: ['openFile'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow?.webContents.send('file:import', {
      format,
      path: result.filePaths[0],
    });
  }
  return result;
}

// Register IPC handlers
function registerIPC() {
  ipcMain.handle('dialog:openFile', async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options || {});
    return result;
  });

  ipcMain.handle('dialog:saveFile', async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options || {});
    return result;
  });

  ipcMain.handle('dialog:messageBox', async (_event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options || {});
    return result;
  });

  ipcMain.handle('fs:readFile', async (_event, filePath) => {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:exists', async (_event, filePath) => {
    return fs.existsSync(filePath);
  });

  ipcMain.handle('ollama:status', async () => {
    await checkOllama();
    return ollamaAvailable;
  });

  ipcMain.handle('ollama:models', async () => {
    if (!ollamaAvailable) return [];
    return new Promise((resolve) => {
      const req = http.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.models || []);
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
    });
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:platform', () => process.platform);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'RouteAI EDA',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a2e' : '#ffffff',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  // Show when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Load frontend
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    // Open devtools in dev mode
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(DIST_DIR, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  // Someone tried to open a second instance — focus existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  registerIPC();
  buildMenu();
  createWindow();

  // Start backend
  try {
    await startBackend();
    console.log('[RouteAI] Backend is ready.');
  } catch (err) {
    console.error('[RouteAI] Backend failed to start:', err.message);
    dialog.showErrorBox(
      'Backend Error',
      `Failed to start the Python backend.\n\n${err.message}\n\nThe application may not work correctly.`
    );
  }

  // Start Ollama polling
  startOllamaPolling();

  app.on('activate', () => {
    // macOS dock click with no windows
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killBackend();
  if (ollamaInterval) clearInterval(ollamaInterval);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killBackend();
  if (ollamaInterval) clearInterval(ollamaInterval);
});
