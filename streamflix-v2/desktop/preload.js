const { contextBridge } = require('electron');

const relayArg = process.argv.find((arg) => arg.startsWith('--streamflix-relay-base='));
const relayBase = relayArg ? relayArg.replace('--streamflix-relay-base=', '') : '';
const appModeArg = process.argv.find((arg) => arg.startsWith('--streamflix-app-mode='));
const appMode = appModeArg ? appModeArg.replace('--streamflix-app-mode=', '') : 'web';

contextBridge.exposeInMainWorld('STREAMFLIX_RELAY_BASE', relayBase);
contextBridge.exposeInMainWorld('streamflixDesktop', {
  relayBase,
  platform: process.platform,
  appMode
});
