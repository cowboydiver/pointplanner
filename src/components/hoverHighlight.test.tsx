import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Line, Station, Edge } from '../types';
import type { MapData } from '../lib/maps';

// Real store + both consumers wired together; only the I/O boundary is mocked so
// the DetailPanel → reducer → TransitMap hover chain runs exactly as it does live.
vi.mock('../data/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {},
}));

const loadMap = vi.fn();
vi.mock('../data/mapsRepo', () => ({
  loadMap: (id: string) => loadMap(id),
  saveMap: async () => ({ ok: true, version: 2 }),
  getMapSource: async () => null,
}));

vi.mock('../store/mapRegistry', () => ({
  useMapRegistry: () => ({ reloadActiveMap: vi.fn(), activeMeta: { id: 'm1', name: 'Test' } }),
}));

import { ProjectStoreProvider } from '../store/projectStore';
import { TransitMap } from './TransitMap';
import { DetailPanel } from './DetailPanel';

const LINES: Line[] = [{ id: 'l', name: 'Line', color: '#2563C9', short: 'L' }];

function station(id: string, col: number, status: Station['status']): Station {
  return {
    id, name: id, lines: ['l'], col, row: 0, lp: 'top', status,
    desc: 'd', owner: 'o', role: '', due: '—', est: '—', tags: [],
  };
}

// design (done) -> build (available) -> ship (locked)
function makeData(): MapData {
  const stations = [station('design', 0, 'done'), station('build', 1, 'available'), station('ship', 2, 'locked')];
  const edges: Edge[] = [
    { from: 'design', to: 'build', line: 'l' },
    { from: 'build', to: 'ship', line: 'l' },
  ];
  return { project: { name: 'P', subtitle: 'S' }, lines: LINES, stations, edges };
}

function stationNode(container: HTMLElement, id: string): SVGGElement {
  const g = container.querySelector(`.g-stations [data-id="${id}"]`);
  if (!g) throw new Error(`no station node for ${id}`);
  return g as unknown as SVGGElement;
}

// The detail panel row whose visible name matches — scoped to the .pre list so it
// never collides with the identically-named map label.
function depRow(container: HTMLElement, name: string): HTMLLIElement {
  const row = [...container.querySelectorAll('.pre')].find(
    li => li.querySelector('.pre-name')?.textContent === name,
  );
  if (!row) throw new Error(`no dependency row for ${name}`);
  return row as HTMLLIElement;
}

async function renderApp() {
  const utils = render(
    <ProjectStoreProvider mapId="m1">
      <TransitMap />
      <DetailPanel />
    </ProjectStoreProvider>,
  );
  // Wait past the async map load ("Loading map…" → real content).
  await waitFor(() => expect(utils.container.querySelector('.g-stations')).toBeTruthy());
  return utils;
}

describe('dependency hover highlight', () => {
  beforeEach(() => {
    loadMap.mockReset();
    loadMap.mockResolvedValue({ id: 'm1', name: 'Test', data: makeData(), version: 1, role: 'owner', isMirror: false });
  });

  it('highlights the "Depends on" station on the map while its row is hovered', async () => {
    const { container } = await renderApp();

    // Open the detail panel for "build" by clicking its marker.
    fireEvent.click(stationNode(container, 'build'));
    await waitFor(() => expect(depRow(container, 'design')).toBeTruthy());

    const design = stationNode(container, 'design');
    expect(design.classList.contains('hover-highlight')).toBe(false);

    fireEvent.mouseOver(depRow(container, 'design'));
    expect(stationNode(container, 'design').classList.contains('hover-highlight')).toBe(true);

    fireEvent.mouseOut(depRow(container, 'design'));
    expect(stationNode(container, 'design').classList.contains('hover-highlight')).toBe(false);
  });

  it('highlights an "Unblocks next" station while its row is hovered', async () => {
    const { container } = await renderApp();

    fireEvent.click(stationNode(container, 'build'));
    await waitFor(() => expect(depRow(container, 'ship')).toBeTruthy());

    fireEvent.mouseOver(depRow(container, 'ship'));
    expect(stationNode(container, 'ship').classList.contains('hover-highlight')).toBe(true);

    fireEvent.mouseOut(depRow(container, 'ship'));
    expect(stationNode(container, 'ship').classList.contains('hover-highlight')).toBe(false);
  });

  it('clears the highlight when navigating to another station', async () => {
    const { container } = await renderApp();

    fireEvent.click(stationNode(container, 'build'));
    await waitFor(() => expect(depRow(container, 'design')).toBeTruthy());

    // Hover then click the row: navigating opens "design" and must drop the hover.
    fireEvent.mouseOver(depRow(container, 'design'));
    expect(stationNode(container, 'design').classList.contains('hover-highlight')).toBe(true);

    fireEvent.click(depRow(container, 'design'));
    await waitFor(() =>
      expect(stationNode(container, 'design').classList.contains('hover-highlight')).toBe(false),
    );
  });
});
