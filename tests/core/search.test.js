import { describe, it, expect } from 'vitest';
import search from '../../src/core/search.js';

const models = [
  { id: 'llama3:8b', name: 'llama3', tag: '8b', family: 'llama', families: ['llama'], parameterSize: '8B', quantization: 'Q4_K_M', sizeBytes: 4_500_000_000, source: 'both', modifiedAt: '2026-01-01T00:00:00Z' },
  { id: 'qwen2.5:7b', name: 'qwen2.5', tag: '7b', family: 'qwen2', families: ['qwen2'], parameterSize: '7B', quantization: 'Q5_K_M', sizeBytes: 5_200_000_000, source: 'disk', modifiedAt: '2026-03-01T00:00:00Z' },
  { id: 'nomic-embed:text', name: 'nomic-embed', tag: 'text', family: 'nomic-bert', families: ['nomic-bert'], parameterSize: '137M', quantization: 'F16', sizeBytes: 274_000_000, source: 'api', modifiedAt: '2025-12-01T00:00:00Z' }
];

describe('search', () => {
  it('filtra por tokens en cualquier campo', () => {
    expect(search.applyFilters(models, { query: 'qwen' })).toHaveLength(1);
    expect(search.applyFilters(models, { query: 'q4_k_m' })).toHaveLength(1);
    expect(search.applyFilters(models, { query: 'embed' })).toHaveLength(1);
    expect(search.applyFilters(models, { query: 'llama 8b' })).toHaveLength(1);
    expect(search.applyFilters(models, { query: 'no-existe' })).toHaveLength(0);
  });

  it('filtra por familia y origen', () => {
    expect(search.applyFilters(models, { families: ['qwen2'] })).toHaveLength(1);
    expect(search.applyFilters(models, { source: 'api' })).toHaveLength(1);
    expect(search.applyFilters(models, { source: 'both' })).toHaveLength(1);
  });

  it('ordena por tamaño y nombre', () => {
    const bySize = search.sortModels(models, 'size', 'desc');
    expect(bySize[0].name).toBe('qwen2.5');
    const byName = search.sortModels(models, 'name', 'asc');
    expect(byName[0].name).toBe('llama3');
  });

  it('resume familias y bytes', () => {
    const summary = search.summarize(models);
    expect(summary.count).toBe(3);
    expect(summary.totalBytes).toBeGreaterThan(0);
    expect(summary.families).toHaveLength(3);
  });
});
