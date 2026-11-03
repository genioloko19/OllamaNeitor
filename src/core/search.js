'use strict';

/** Filtro y orden puros sobre el inventario de modelos. */

function normalize(value) {
  return String(value || '').toLowerCase();
}

function modelHaystack(model) {
  return normalize([
    model.name,
    model.tag,
    `${model.name}:${model.tag}`,
    model.family,
    (model.families || []).join(' '),
    model.parameterSize,
    model.quantization,
    model.format,
    model.digest
  ].join(' '));
}

function matchesQuery(model, query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = modelHaystack(model);
  return tokens.every((token) => haystack.includes(token));
}

function applyFilters(models, { query = '', families = [], source = 'all' } = {}) {
  const familySet = new Set((families || []).map(normalize).filter(Boolean));
  return models.filter((model) => {
    if (!matchesQuery(model, query)) return false;
    if (familySet.size && !familySet.has(normalize(model.family))) return false;
    if (source !== 'all' && model.source !== source) return false;
    return true;
  });
}

function sortModels(models, key = 'name', direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const copy = [...models];
  copy.sort((a, b) => {
    switch (key) {
      case 'size':
        return (Number(a.sizeBytes) - Number(b.sizeBytes)) * dir;
      case 'family':
        return collator.compare(a.family || '', b.family || '') * dir;
      case 'modified':
        return (new Date(a.modifiedAt || 0) - new Date(b.modifiedAt || 0)) * dir;
      case 'quantization':
        return collator.compare(a.quantization || '', b.quantization || '') * dir;
      default:
        return collator.compare(`${a.name}:${a.tag}`, `${b.name}:${b.tag}`) * dir;
    }
  });
  return copy;
}

function summarize(models) {
  const totalBytes = models.reduce((sum, model) => sum + (Number(model.sizeBytes) || 0), 0);
  const families = {};
  for (const model of models) {
    const family = model.family || 'desconocida';
    families[family] = (families[family] || 0) + 1;
  }
  return {
    count: models.length,
    totalBytes,
    families: Object.entries(families)
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count)
  };
}

module.exports = { matchesQuery, applyFilters, sortModels, summarize, modelHaystack };
