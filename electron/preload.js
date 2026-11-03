'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    reset: () => ipcRenderer.invoke('config:reset'),
    paths: () => ipcRenderer.invoke('config:paths')
  },
  system: {
    getTheme: () => ipcRenderer.invoke('system:theme'),
    onThemeChange: (callback) => subscribe('system:theme', callback)
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    delete: (id) => ipcRenderer.invoke('models:delete', id),
    blobStats: () => ipcRenderer.invoke('models:blobStats'),
    show: (id) => ipcRenderer.invoke('models:show', id),
    details: (id) => ipcRenderer.invoke('models:details', id)
  },
  transfer: {
    startExport: (payload) => ipcRenderer.invoke('export:start', payload),
    cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
    scanFolder: (folder) => ipcRenderer.invoke('import:scanFolder', folder),
    scanTar: (file) => ipcRenderer.invoke('import:scanTar', file),
    startImport: (payload) => ipcRenderer.invoke('import:start', payload),
    cancelImport: (jobId) => ipcRenderer.invoke('import:cancel', jobId),
    onProgress: (callback) => subscribe('transfer:progress', callback),
    onResult: (callback) => subscribe('transfer:result', callback),
    onError: (callback) => subscribe('transfer:error', callback),
    onCancelled: (callback) => subscribe('transfer:cancelled', callback)
  },
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    ps: () => ipcRenderer.invoke('ollama:ps'),
    unload: (id) => ipcRenderer.invoke('ollama:unload', id),
    pull: (model) => ipcRenderer.invoke('ollama:pull', model),
    cancelPull: () => ipcRenderer.invoke('ollama:cancelPull'),
    onPullProgress: (callback) => subscribe('ollama:pullProgress', callback),
    onPullError: (callback) => subscribe('ollama:pullError', callback)
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    onChunk: (callback) => subscribe('chat:chunk', callback),
    onDone: (callback) => subscribe('chat:done', callback),
    onError: (callback) => subscribe('chat:error', callback),
    list: () => ipcRenderer.invoke('chat:list'),
    get: (id) => ipcRenderer.invoke('chat:get', id),
    save: (conversation) => ipcRenderer.invoke('chat:save', conversation),
    remove: (id) => ipcRenderer.invoke('chat:remove', id)
  },
  achievements: {
    get: () => ipcRenderer.invoke('achievements:get'),
    reset: () => ipcRenderer.invoke('achievements:reset'),
    onState: (callback) => subscribe('achievements:state', callback),
    onUnlocked: (callback) => subscribe('achievements:unlocked', callback)
  },
  dialogs: {
    pickFolder: (options) => ipcRenderer.invoke('dialog:pickFolder', options || {}),
    pickTarFiles: () => ipcRenderer.invoke('dialog:pickTarFiles')
  },
  shell: {
    openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
    showItem: (target) => ipcRenderer.invoke('shell:showItem', target),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  logs: {
    list: () => ipcRenderer.invoke('log:list'),
    openFolder: () => ipcRenderer.invoke('log:openFolder'),
    onEvent: (callback) => subscribe('log:event', callback)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setBackground: (color) => ipcRenderer.invoke('window:setBackground', color),
    setAcrylic: (enabled) => ipcRenderer.invoke('window:setAcrylic', enabled),
    onMaximize: (callback) => subscribe('window:maximized', callback)
  },
  appearance: {
    persist: (appearance) => ipcRenderer.invoke('appearance:persist', appearance)
  }
};

contextBridge.exposeInMainWorld('neitor', api);
