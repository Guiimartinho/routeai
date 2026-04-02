// RouteAI EDA - Electron Main Process
// Creates the desktop application shell, manages backend services
// (Go API, Python ML), and provides native OS integration
// (menus, dialogs, Ollama detection).

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
const { spawn, execSync } = require('child_process');
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
let goApiProcess = null;
let mlServiceProcess = null;
let ollamaAvailable = false;
let goApiReady = false;
let mlServiceReady = false;

const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:3000';
const GO_API_PORT = 8080;
const ML_SERVICE_PORT = 8001;
const OLLAMA_URL = 'http://localhost:11434';

// Paths
const ROOT_DIR = isDev
  ? path.resolve(__dirname, '..', '..')
  : path.resolve(process.resourcesPath);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PRELOAD = path.join(__dirname, 'preload.js');

// ---------------------------------------------------------------------------
// Ollama detection — polls /api/tags which is the proper health endpoint
// ---------------------------------------------------------------------------
function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, { timeout: 2000 }, (res) => {
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
  const parts = ['RouteAI EDA'];
  if (goApiReady) parts.push('API Connected');
  else parts.push('API Offline');
  if (ollamaAvailable) parts.push('Ollama Connected');
  else parts.push('Ollama Offline');
  mainWindow.setTitle(parts.join('  |  '));
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
// Go API management
// ---------------------------------------------------------------------------

/**
 * Find the Go API binary path.
 * - Production: bundled at process.resourcesPath/routeai-api(.exe)
 * - Dev: built binary at packages/api/routeai-api(.exe), or fall back to
 *        assuming start.sh runs it separately.
 */
function findGoApiBinary() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `routeai-api${ext}`;

  if (!isDev) {
    // Production: check multiple possible locations in resources/
    const candidates = [
      path.join(process.resourcesPath, binaryName),
      path.join(process.resourcesPath, 'bin', binaryName),
      path.join(process.resourcesPath, 'backend', binaryName),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  // Dev mode: check if binary exists in packages/api/
  const devBinary = path.join(ROOT_DIR, 'packages', 'api', binaryName);
  if (fs.existsSync(devBinary)) return devBinary;

  return null;
}

function waitForService(port, healthPath, retries = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(
        `http://localhost:${port}${healthPath}`,
        { timeout: 1000 },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(true);
          } else {
            retry();
          }
        }
      );
      req.on('error', () => retry());
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      attempts++;
      if (attempts >= retries) {
        reject(new Error(`Service on port ${port} did not start after ${retries} attempts`));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

/**
 * Check if a service is already running on the given port.
 */
function isServiceRunning(port, healthPath) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${port}${healthPath}`,
      { timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startGoApi() {
  // In dev mode, check if the Go API is already running (started by start.sh)
  if (isDev) {
    const alreadyRunning = await isServiceRunning(GO_API_PORT, '/health');
    if (alreadyRunning) {
      console.log('[RouteAI] Go API already running on port 8080 (started externally).');
      goApiReady = true;
      return;
    }
  }

  const binary = findGoApiBinary();
  if (!binary) {
    if (isDev) {
      console.warn(
        '[RouteAI] Go API binary not found at packages/api/routeai-api.\n' +
        '  Run "./start.sh" to build and start all services, or:\n' +
        '  cd packages/api && go build -o routeai-api . && ./routeai-api'
      );
      return; // Not fatal in dev — user can start it manually
    }
    throw new Error(
      'Go API binary not found in application resources.\n' +
      'The installation may be corrupted. Please reinstall RouteAI EDA.'
    );
  }

  console.log(`[RouteAI] Starting Go API: ${binary}`);

  const env = { ...process.env };
  env.GIN_MODE = isDev ? 'debug' : 'release';
  env.ML_SERVICE_URL = `http://localhost:${ML_SERVICE_PORT}`;
  env.OLLAMA_BASE_URL = OLLAMA_URL;

  if (isDev) {
    // Dev mode: set data paths relative to project root
    env.KICAD_INDEX_PATH = path.join(ROOT_DIR, 'data', 'component_library', 'kicad_index.json');
    env.KICAD_SYMBOLS_PATH = path.join(ROOT_DIR, 'data', 'component_library', 'kicad_symbols.json');
  } else {
    // Production: data is in resources/data/component_library/ (matches build-config.js)
    env.KICAD_INDEX_PATH = path.join(process.resourcesPath, 'data', 'component_library', 'kicad_index.json');
    env.KICAD_SYMBOLS_PATH = path.join(process.resourcesPath, 'data', 'component_library', 'kicad_symbols.json');
  }

  const cwd = path.dirname(binary);

  goApiProcess = spawn(binary, [], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  goApiProcess.stdout.on('data', (data) => {
    console.log(`[GoAPI] ${data.toString().trimEnd()}`);
  });

  goApiProcess.stderr.on('data', (data) => {
    console.error(`[GoAPI] ${data.toString().trimEnd()}`);
  });

  goApiProcess.on('close', (code) => {
    console.log(`[RouteAI] Go API exited with code ${code}`);
    goApiProcess = null;
    goApiReady = false;
    updateTitle();
  });

  goApiProcess.on('error', (err) => {
    console.error('[RouteAI] Failed to start Go API:', err.message);
    goApiProcess = null;
    goApiReady = false;
  });

  await waitForService(GO_API_PORT, '/health');
  goApiReady = true;
  console.log('[RouteAI] Go API is ready on port 8080.');
}

function killGoApi() {
  if (!goApiProcess) return;
  console.log('[RouteAI] Stopping Go API...');
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(goApiProcess.pid), '/f', '/t']);
    } else {
      goApiProcess.kill('SIGTERM');
      setTimeout(() => {
        if (goApiProcess) {
          try { goApiProcess.kill('SIGKILL'); } catch (_) { /* already dead */ }
        }
      }, 3000);
    }
  } catch (err) {
    console.error('[RouteAI] Error killing Go API:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Python ML service management (optional — AI features degrade gracefully)
// ---------------------------------------------------------------------------

/**
 * Find a working Python 3 interpreter.
 * Returns null if none found.
 */
function findPython() {
  // In packaged builds, check for bundled Python
  if (!isDev) {
    const bundled = path.join(process.resourcesPath, 'python', 'python3');
    if (fs.existsSync(bundled)) return bundled;
    const bundledWin = path.join(process.resourcesPath, 'python', 'python.exe');
    if (fs.existsSync(bundledWin)) return bundledWin;
  }

  // Try system Python
  const cmd = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return cmd;
  } catch {
    return null;
  }
}

async function startMlService() {
  // In dev mode, check if ML service is already running (started by start.sh)
  if (isDev) {
    const alreadyRunning = await isServiceRunning(ML_SERVICE_PORT, '/health');
    if (alreadyRunning) {
      console.log('[RouteAI] ML service already running on port 8001 (started externally).');
      mlServiceReady = true;
      return;
    }
  }

  const python = findPython();
  if (!python) {
    console.warn(
      '[RouteAI] Python not found. ML/AI features will be limited.\n' +
      '  Install Python 3.10+ and the intelligence package for full AI capabilities.'
    );
    return; // Not fatal — AI features degrade gracefully
  }

  // Check if the intelligence package is available
  const intelligenceDir = isDev
    ? path.join(ROOT_DIR, 'packages', 'intelligence')
    : path.join(process.resourcesPath, 'backend', 'packages', 'intelligence');

  if (!fs.existsSync(intelligenceDir)) {
    console.warn('[RouteAI] Intelligence package not found. ML features disabled.');
    return;
  }

  console.log(`[RouteAI] Starting ML service: ${python}`);

  const env = { ...process.env };
  env.HOST = '127.0.0.1';
  env.PORT = String(ML_SERVICE_PORT);

  // Try to start via uvicorn
  const args = [
    '-m', 'uvicorn',
    'routeai_intelligence.ml_service:app',
    '--host', '127.0.0.1',
    '--port', String(ML_SERVICE_PORT),
  ];

  mlServiceProcess = spawn(python, args, {
    cwd: intelligenceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  mlServiceProcess.stdout.on('data', (data) => {
    console.log(`[MLSvc] ${data.toString().trimEnd()}`);
  });

  mlServiceProcess.stderr.on('data', (data) => {
    // uvicorn logs to stderr by default
    console.log(`[MLSvc] ${data.toString().trimEnd()}`);
  });

  mlServiceProcess.on('close', (code) => {
    console.log(`[RouteAI] ML service exited with code ${code}`);
    mlServiceProcess = null;
    mlServiceReady = false;
  });

  mlServiceProcess.on('error', (err) => {
    console.error('[RouteAI] Failed to start ML service:', err.message);
    mlServiceProcess = null;
  });

  try {
    await waitForService(ML_SERVICE_PORT, '/health', 20, 500);
    mlServiceReady = true;
    console.log('[RouteAI] ML service is ready on port 8001.');
  } catch (err) {
    console.warn(`[RouteAI] ML service did not start: ${err.message}`);
    console.warn('[RouteAI] AI features will be limited. This is not a fatal error.');
    // Kill the process if it's still hanging
    if (mlServiceProcess) {
      try { mlServiceProcess.kill(); } catch (_) { /* ignore */ }
      mlServiceProcess = null;
    }
  }
}

function killMlService() {
  if (!mlServiceProcess) return;
  console.log('[RouteAI] Stopping ML service...');
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(mlServiceProcess.pid), '/f', '/t']);
    } else {
      mlServiceProcess.kill('SIGTERM');
      setTimeout(() => {
        if (mlServiceProcess) {
          try { mlServiceProcess.kill('SIGKILL'); } catch (_) { /* already dead */ }
        }
      }, 3000);
    }
  } catch (err) {
    console.error('[RouteAI] Error killing ML service:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Kill all managed services
// ---------------------------------------------------------------------------
function killAllServices() {
  killGoApi();
  killMlService();
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
          label: 'Service Status',
          click: async () => {
            await checkOllama();
            updateTitle();
            const lines = [
              `Go API: ${goApiReady ? 'Running (port 8080)' : 'Not available'}`,
              `ML Service: ${mlServiceReady ? 'Running (port 8001)' : 'Not available'}`,
              `Ollama: ${ollamaAvailable ? 'Connected (port 11434)' : 'Not detected'}`,
            ];
            if (!ollamaAvailable) {
              lines.push('', 'Install Ollama for local AI inference:');
              lines.push('https://ollama.ai/install');
            }
            dialog.showMessageBox(mainWindow, {
              type: goApiReady ? 'info' : 'warning',
              title: 'Service Status',
              message: 'RouteAI EDA Services',
              detail: lines.join('\n'),
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
                'Built with Electron, React, Go, and Claude AI.\n' +
                `Go API: ${goApiReady ? 'Connected' : 'Not running'}\n` +
                `ML Service: ${mlServiceReady ? 'Connected' : 'Not running'}\n` +
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

  ipcMain.handle('services:status', async () => {
    return {
      goApi: goApiReady,
      mlService: mlServiceReady,
      ollama: ollamaAvailable,
    };
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

  // Start Go API (primary backend)
  try {
    await startGoApi();
    console.log('[RouteAI] Go API service started successfully.');
  } catch (err) {
    console.error('[RouteAI] Go API failed to start:', err.message);
    goApiReady = false;
    dialog.showErrorBox(
      'Backend Error',
      `Failed to start the Go API backend.\n\n${err.message}\n\n` +
      'The application may not work correctly.\n\n' +
      (isDev
        ? 'In development, run ./start.sh to start all services.'
        : 'Try reinstalling RouteAI EDA.')
    );
  }

  // Start ML service (optional — AI features degrade gracefully)
  try {
    await startMlService();
  } catch (err) {
    console.warn('[RouteAI] ML service not available:', err.message);
    // Not fatal — the app works without ML
  }

  // Start Ollama polling (external dependency — app works without it)
  startOllamaPolling();

  // Update title with final status
  updateTitle();

  app.on('activate', () => {
    // macOS dock click with no windows
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAllServices();
  if (ollamaInterval) clearInterval(ollamaInterval);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killAllServices();
  if (ollamaInterval) clearInterval(ollamaInterval);
});
