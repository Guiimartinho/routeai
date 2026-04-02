// RouteAI EDA - Electron Preload Script
// Exposes a safe subset of native APIs to the renderer process
// via contextBridge. The renderer accesses these through window.routeai.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('routeai', {
  // -----------------------------------------------------------------------
  // Platform info
  // -----------------------------------------------------------------------
  platform: process.platform,
  isElectron: true,

  getVersion: () => ipcRenderer.invoke('app:version'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),

  // -----------------------------------------------------------------------
  // Native file dialogs
  // -----------------------------------------------------------------------
  dialog: {
    /**
     * Open a file picker dialog.
     * @param {object} options - Electron dialog.showOpenDialog options
     * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
     */
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),

    /**
     * Open a save dialog.
     * @param {object} options - Electron dialog.showSaveDialog options
     * @returns {Promise<{canceled: boolean, filePath: string}>}
     */
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),

    /**
     * Show a message box.
     * @param {object} options - Electron dialog.showMessageBox options
     * @returns {Promise<{response: number, checkboxChecked: boolean}>}
     */
    messageBox: (options) => ipcRenderer.invoke('dialog:messageBox', options),
  },

  // -----------------------------------------------------------------------
  // File system (read/write project files)
  // -----------------------------------------------------------------------
  fs: {
    /**
     * Read a text file from disk.
     * @param {string} filePath - Absolute path to the file
     * @returns {Promise<{success: boolean, data?: string, error?: string}>}
     */
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),

    /**
     * Write text content to a file.
     * @param {string} filePath - Absolute path to the file
     * @param {string} content  - Text content to write
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    writeFile: (filePath, content) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),

    /**
     * Check if a file/directory exists.
     * @param {string} filePath - Absolute path
     * @returns {Promise<boolean>}
     */
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  },

  // -----------------------------------------------------------------------
  // Service status
  // -----------------------------------------------------------------------
  services: {
    /**
     * Get status of all backend services.
     * @returns {Promise<{goApi: boolean, mlService: boolean, ollama: boolean}>}
     */
    status: () => ipcRenderer.invoke('services:status'),
  },

  // -----------------------------------------------------------------------
  // Ollama integration
  // -----------------------------------------------------------------------
  ollama: {
    /**
     * Check if Ollama is running.
     * @returns {Promise<boolean>}
     */
    isAvailable: () => ipcRenderer.invoke('ollama:status'),

    /**
     * List available Ollama models.
     * @returns {Promise<Array>}
     */
    listModels: () => ipcRenderer.invoke('ollama:models'),
  },

  // -----------------------------------------------------------------------
  // Menu events (main process -> renderer)
  // -----------------------------------------------------------------------
  onMenuSave: (callback) => {
    ipcRenderer.on('menu:save', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:save');
  },

  onMenuSettings: (callback) => {
    ipcRenderer.on('menu:settings', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:settings');
  },

  onMenuTool: (callback) => {
    ipcRenderer.on('menu:tool', (_event, tool) => callback(tool));
    return () => ipcRenderer.removeAllListeners('menu:tool');
  },

  onMenuExport: (callback) => {
    ipcRenderer.on('menu:export', (_event, format) => callback(format));
    return () => ipcRenderer.removeAllListeners('menu:export');
  },

  onFileOpened: (callback) => {
    ipcRenderer.on('file:opened', (_event, filePath) => callback(filePath));
    return () => ipcRenderer.removeAllListeners('file:opened');
  },

  onFileSavePath: (callback) => {
    ipcRenderer.on('file:save-path', (_event, filePath) => callback(filePath));
    return () => ipcRenderer.removeAllListeners('file:save-path');
  },

  onFileImport: (callback) => {
    ipcRenderer.on('file:import', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('file:import');
  },
});
