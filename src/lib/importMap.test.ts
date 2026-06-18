import { describe, it, expect } from 'vitest';
import { parseMapFile } from './importMap';
import { createSeedMapData } from './maps';
import type { MapData } from './maps';

function serialize(data: MapData): string {
  return JSON.stringify(data, null, 2);
}

describe('parseMapFile', () => {
  it('imports a well-formed generated map', () => {
    const seed = createSeedMapData();
    const result = parseMapFile(serialize(seed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe(seed.project.name);
    expect(result.data.stations).toHaveLength(seed.stations.length);
    expect(result.data.lines).toHaveLength(seed.lines.length);
    expect(result.data.edges).toHaveLength(seed.edges.length);
  });

  it('preserves a station sourceUrl from a roadmap map', () => {
    const map: MapData = {
      project: { name: 'Roadmap', subtitle: '' },
      lines: [{ id: 'backlog', name: 'Backlog', color: '#D8392F', short: 'BA' }],
      stations: [
        {
          id: 'issue-1',
          name: 'Do a thing',
          lines: ['backlog'],
          col: 0,
          row: 0,
          lp: 'top',
          status: 'available',
          desc: '',
          owner: 'Unassigned',
          role: '',
          due: '—',
          est: '—',
          tags: ['ready-for-agent'],
          sourceUrl: 'https://github.com/cowboydiver/pointplanner/issues/1',
        },
      ],
      edges: [],
    };
    const result = parseMapFile(serialize(map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stations[0].sourceUrl).toBe(
      'https://github.com/cowboydiver/pointplanner/issues/1',
    );
  });

  it('rejects non-JSON input', () => {
    const result = parseMapFile('not json {');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid json/i);
  });

  it('rejects a JSON value that is not an object', () => {
    const result = parseMapFile('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/expected a json object/i);
  });

  it('rejects an object missing the map arrays', () => {
    const result = parseMapFile(JSON.stringify({ project: { name: 'X' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/"lines" must be an array/i);
  });

  it('rejects a map whose edges reference a missing station', () => {
    const map = createSeedMapData();
    map.edges = [{ from: map.stations[0].id, to: 'ghost', line: map.lines[0].id }];
    const result = parseMapFile(serialize(map));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing station "ghost"/i);
  });

  it('strips unknown top-level keys', () => {
    const seed = createSeedMapData();
    const withExtra = { ...seed, secrets: { token: 'abc' } };
    const result = parseMapFile(JSON.stringify(withExtra));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data).sort()).toEqual(
      ['edges', 'lines', 'project', 'stations'],
    );
  });

  it('falls back to a default name when the project name is blank', () => {
    const seed = createSeedMapData();
    seed.project.name = '   ';
    const result = parseMapFile(serialize(seed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe('Imported map');
  });

  it('defaults cosmetic station fields on a minimal hand-edited file', () => {
    const map = {
      project: { name: 'Minimal' },
      lines: [{ id: 'main' }],
      stations: [{ id: 'a', lines: ['main'], col: 0, row: 0 }],
      edges: [],
    };
    const result = parseMapFile(JSON.stringify(map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [station] = result.data.stations;
    expect(station.name).toBe('a');
    expect(station.lp).toBe('top');
    expect(station.status).toBe('available');
    expect(station.tags).toEqual([]);
    expect(result.data.project.subtitle).toBe('');
  });
});
