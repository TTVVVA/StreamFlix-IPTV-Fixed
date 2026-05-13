const path = require('path');
const http = require('node:http');
const { app, BrowserWindow, shell } = require('electron');
const { createStreamFlixApp } = require('../lib/streamflix-app');

let localServer = null;
let localPort = null;

async function startLocalServer() {
  if (localServer) return localPort;

  const webApp = createStreamFlixApp({ staticDir: path.resolve(__dirname, '..') });
  localServer = http.createServer(webApp);

  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = localServer.address();
  localPort = address && typeof address === 'object' ? address.port : null;
  return localPort;
}

async function stopLocalServer() {
  if (!localServer) return;
  await new Promise((resolve) => {
    localServer.close(() => resolve());
  });
  localServer = null;
  localPort = null;
}

function createMainWindow() {
  const relayBase = `http://127.0.0.1:${localPort}/api/relay`;
  const appBaseUrl = `http://127.0.0.1:${localPort}`;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'StreamFlix Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      additionalArguments: [
        `--streamflix-relay-base=${relayBase}`,
        '--streamflix-app-mode=desktop'
      ]
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      const isLocal = parsed.origin === appBaseUrl;
      if (!isLocal) {
        event.preventDefault();
        shell.openExternal(targetUrl).catch(() => {});
        return;
      }

      if (parsed.pathname.endsWith('/download.html')) {
        event.preventDefault();
        win.loadURL(`${appBaseUrl}/index.html?mode=desktop`);
      }
    } catch (_error) {
      // Ignore malformed URLs.
    }
  });

  win.loadURL(`${appBaseUrl}/index.html?mode=desktop`);
}

app.whenReady().then(async () => {
  await startLocalServer();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopLocalServer().catch(() => {});
});
