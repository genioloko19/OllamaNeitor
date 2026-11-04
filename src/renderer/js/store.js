/** Estado global mínimo con suscripciones. */

const state = {
  ready: false,
  route: 'dashboard',
  platform: 'win32',
  version: '1.1.0',
  paths: {},
  base: {},
  config: null,
  appearance: { theme: 'cyber-neon', variant: 'auto', glass: 0.8, orbs: true },
  systemDark: true,
  models: [],
  summary: { count: 0, diskBytes: 0, totalBytes: 0 },
  ollama: { online: false },
  ps: [],
  achievements: null,
  selection: new Set(),
  logs: []
};

const listeners = new Set();

export function getState() {
  return state;
}

export function patch(partial) {
  Object.assign(state, partial);
  for (const listener of [...listeners]) {
    try { listener(state); } catch (error) { console.error(error); }
  }
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSelected(id) {
  return state.selection.has(id);
}

export function setSelected(id, selected) {
  if (selected) state.selection.add(id);
  else state.selection.delete(id);
  patch({});
}

export function toggleSelected(id) {
  setSelected(id, !state.selection.has(id));
}

export function selectMany(ids, selected) {
  for (const id of ids) {
    if (selected) state.selection.add(id);
    else state.selection.delete(id);
  }
  patch({});
}

export function clearSelection() {
  state.selection.clear();
  patch({});
}

export function selectedModels() {
  return state.models.filter((model) => state.selection.has(model.id));
}
