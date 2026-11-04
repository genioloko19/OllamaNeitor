'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    onNavigate: (callback) => subscribe('app:navigate', callback)
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
    deleteOrphans: (payload) => ipcRenderer.invoke('models:deleteOrphans', payload),
    verify: (id) => ipcRenderer.invoke('models:verify', id),
    show: (id) => ipcRenderer.invoke('models:show', id),
    details: (id) => ipcRenderer.invoke('models:details', id)
  },
  jobs: {
    list: (payload) => ipcRenderer.invoke('jobs:list', payload),
    get: (id) => ipcRenderer.invoke('jobs:get', id),
    cancel: (id) => ipcRenderer.invoke('jobs:cancel', id),
    retry: (id) => ipcRenderer.invoke('jobs:retry', id),
    clearHistory: () => ipcRenderer.invoke('jobs:clearHistory'),
    onChanged: (callback) => subscribe('jobs:changed', callback),
    onProgress: (callback) => subscribe('jobs:progress', callback),
    onFinished: (callback) => subscribe('jobs:finished', callback)
  },
  backup: {
    create: (payload) => ipcRenderer.invoke('backup:create', payload),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (payload) => ipcRenderer.invoke('backup:restore', payload),
    openFolder: () => ipcRenderer.invoke('backup:openFolder')
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback) => subscribe('updater:status', callback)
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
    status: (options) => ipcRenderer.invoke('ollama:status', options || {}),
    ps: () => ipcRenderer.invoke('ollama:ps'),
    unload: (id) => ipcRenderer.invoke('ollama:unload', id),
    unloadMany: (ids) => ipcRenderer.invoke('ollama:unloadMany', ids),
    pull: (model) => ipcRenderer.invoke('ollama:pull', model),
    pullMany: (models) => ipcRenderer.invoke('ollama:pullMany', models),
    cancelPull: () => ipcRenderer.invoke('ollama:cancelPull'),
    copy: (source, destination) => ipcRenderer.invoke('ollama:copy', { source, destination }),
    push: (model) => ipcRenderer.invoke('ollama:push', model),
    create: (model, file) => ipcRenderer.invoke('ollama:create', { model, file }),
    deleteMany: (ids) => ipcRenderer.invoke('ollama:deleteMany', ids),
    onPullProgress: (callback) => subscribe('ollama:pullProgress', callback),
    onPullError: (callback) => subscribe('ollama:pullError', callback)
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    capabilities: (model) => ipcRenderer.invoke('chat:capabilities', model),
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
    pickTarFiles: () => ipcRenderer.invoke('dialog:pickTarFiles'),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options || {}),
    pickBackup: () => ipcRenderer.invoke('dialog:pickBackup'),
    pickFile: (options) => ipcRenderer.invoke('dialog:pickFile', options || {}),
    pickImages: () => ipcRenderer.invoke('dialog:pickImages')
  },
  files: {
    readBase64: (paths) => ipcRenderer.invoke('files:readBase64', paths)
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
