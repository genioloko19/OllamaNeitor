/** Servicios de datos compartidos por las vistas. */

import { bridge, call } from './ipc.js';
import { getState, patch } from './store.js';

export async function loadAppInfo() {
  const info = await call(bridge.app.info);
  patch({
    version: info.version,
    platform: info.platform,
    paths: info.paths,
    base: info.base,
    config: info.config
  });
  return info;
}

export async function loadConfig() {
  const config = await call(bridge.config.get);
  patch({ config });
  return config;
}

export async function saveConfig(patchData) {
  const config = await call(bridge.config.set, patchData);
  patch({ config });
  return config;
}

export async function refreshModels({ silent = false } = {}) {
  try {
    const data = await call(bridge.models.list);
    patch({
      models: data.models,
      summary: data.summary,
      ollama: data.ollama,
      base: { ...getState().base, valid: data.models.length >= 0 }
    });
    return data;
  } catch (error) {
    if (!silent) throw error;
    return null;
  }
}

export async function refreshStatus() {
  try {
    const data = await call(bridge.ollama.status);
    patch({ ollama: data });
    return data;
  } catch (error) {
    patch({ ollama: { online: false, error: error.message } });
    return null;
  }
}

export async function refreshPs() {
  try {
    const ps = await call(bridge.ollama.ps);
    patch({ ps });
    return ps;
  } catch (error) {
    patch({ ps: [] });
    return [];
  }
}

export async function refreshAchievements() {
  try {
    const achievements = await call(bridge.achievements.get);
    patch({ achievements });
    return achievements;
  } catch (error) {
    return null;
  }
}

export async function refreshBlobStats() {
  return call(bridge.models.blobStats);
}

export async function refreshAll({ silent = true } = {}) {
  const results = await Promise.allSettled([
    refreshModels({ silent }),
    refreshStatus(),
    refreshAchievements(),
    refreshPs()
  ]);
  return results;
}

export function formatVariantLabel(variant) {
  if (variant === 'light') return 'Claro';
  if (variant === 'dark') return 'Oscuro';
  if (variant === 'contrast') return 'Alto contraste';
  return 'Auto (Windows)';
}
