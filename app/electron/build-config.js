// RouteAI EDA - Electron Builder Configuration
// Used by electron-builder to produce distributable packages.
// Import this in package.json "build" or pass via --config flag.

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'dev.routeai.eda',
  productName: 'RouteAI EDA',
  copyright: 'Copyright (c) 2026 RouteAI',

  // Directories
  directories: {
    output: 'release',
    buildResources: 'electron/resources',
  },

  // Files to include in the app
  files: [
    'dist/**/*',
    'electron/**/*',
    '!electron/resources',
    'package.json',
  ],

  // Extra resources bundled alongside the app (not inside asar)
  extraResources: [
    {
      from: '../server.py',
      to: 'backend/server.py',
    },
    {
      from: '../packages',
      to: 'backend/packages',
      filter: [
        '**/*.py',
        '**/pyproject.toml',
        '!**/__pycache__',
        '!**/.pytest_cache',
        '!**/node_modules',
      ],
    },
  ],

  // Do not use asar for backend files
  asar: true,
  asarUnpack: ['electron/**'],

  // ---------------------------------------------------------------------------
  // Windows — NSIS installer
  // ---------------------------------------------------------------------------
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'electron/resources/icon.ico',
    artifactName: '${productName}-Setup-${version}-win-${arch}.${ext}',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'RouteAI EDA',
    installerIcon: 'electron/resources/icon.ico',
    uninstallerIcon: 'electron/resources/icon.ico',
    installerHeaderIcon: 'electron/resources/icon.ico',
    license: 'LICENSE',
  },

  // ---------------------------------------------------------------------------
  // Linux — AppImage + deb
  // ---------------------------------------------------------------------------
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'electron/resources/icons',
    category: 'Development',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    desktop: {
      Name: 'RouteAI EDA',
      Comment: 'AI-Powered PCB Design Tool',
      Categories: 'Development;Electronics;Engineering',
      Keywords: 'PCB;EDA;routing;electronics;AI',
    },
  },

  deb: {
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6'],
    packageCategory: 'devel',
  },

  // ---------------------------------------------------------------------------
  // macOS (future support)
  // ---------------------------------------------------------------------------
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
    ],
    icon: 'electron/resources/icon.icns',
    category: 'public.app-category.developer-tools',
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    hardenedRuntime: true,
    gatekeeperAssess: false,
  },

  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Auto-update via GitHub Releases
  // ---------------------------------------------------------------------------
  publish: [
    {
      provider: 'github',
      owner: 'routeai',
      repo: 'routeai-eda',
      releaseType: 'release',
    },
  ],

  // Hooks
  afterPack: async (context) => {
    console.log(`[electron-builder] Packed for ${context.electronPlatformName}`);
  },
};

module.exports = config;
