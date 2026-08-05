import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Edge, Line, Station } from '../types';
import type { MapData } from '../lib/maps';
import type { MapRole } from '../data/mapsRepo';

// Real store + real Legend; only the I/O boundary is mocked. A read-only store
// also subscribes to Realtime, hence the channel stub.
vi.mock('../data/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
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
import { Legend } from './Legend';

const LINES: Line[] = [
  { id: 'l', name: 'Line', color: '#2563C9', short: 'L' },
  { id: 'm', name: 'Other', color: '#1E9C55', short: 'M' },
];

function station(id: string, col: number, status: Station['status'], lines = ['l']): Station {
  return {
    id, name: id, lines, col, row: 0, lp: 'top', status,
    desc: 'd', owner: 'o', role: '', due: '—', est: '—', tags: [],
  };
}

function makeData(): MapData {
  const stations = [station('design', 0, 'done'), station('build', 1, 'available', ['m'])];
  const edges: Edge[] = [];
  return { project: { name: 'P', subtitle: 'S' }, lines: LINES, stations, edges };
}

function mount(role: MapRole, isMirror: boolean) {
  loadMap.mockResolvedValue({
    id: 'm1', name: 'Test', data: makeData(), version: 1, role, isMirror,
  });
}

async function renderLegend() {
  const utils = render(
    <ProjectStoreProvider mapId="m1">
      <Legend />
    </ProjectStoreProvider>,
  );
  await waitFor(() => expect(utils.container.querySelector('.legend')).toBeTruthy());
  return utils;
}

describe('Legend on read-only maps', () => {
  beforeEach(() => {
    loadMap.mockReset();
  });

  const readOnlyCases: [string, MapRole, boolean][] = [
    ['a Viewer share', 'viewer', false],
    ['a GitHub mirror', 'owner', true],
  ];

  for (const [name, role, isMirror] of readOnlyCases) {
    describe(name, () => {
      beforeEach(() => mount(role, isMirror));

      it('offers no way to add, edit or delete a line', async () => {
        const { container } = await renderLegend();

        expect(container.querySelector('.add-line')).toBeNull();
        expect(container.querySelectorAll('.line-edit')).toHaveLength(0);
        expect(container.querySelectorAll('.line-delete')).toHaveLength(0);
      });

      it('still lists the lines and their progress', async () => {
        const { container } = await renderLegend();

        expect(container.querySelectorAll('.line-row')).toHaveLength(2);
        expect(container.textContent).toContain('Line');
        expect(container.textContent).toContain('Other');
      });

      it('still toggles the line highlight — that is view-only', async () => {
        const { container } = await renderLegend();

        const row = container.querySelector('.line-row')!;
        expect(row.classList.contains('on')).toBe(false);

        fireEvent.click(row.querySelector('.line-row-btn')!);
        await waitFor(() =>
          expect(container.querySelector('.line-row')!.classList.contains('on')).toBe(true),
        );
      });
    });
  }

  describe('an editable map', () => {
    it('does offer the line controls, so the read-only assertions mean something', async () => {
      mount('owner', false);
      const { container } = await renderLegend();

      expect(container.querySelector('.add-line')).toBeTruthy();
      expect(container.querySelectorAll('.line-edit')).toHaveLength(2);
      expect(container.querySelectorAll('.line-delete')).toHaveLength(2);
    });

    it('gives an Editor share the same line controls', async () => {
      mount('editor', false);
      const { container } = await renderLegend();

      expect(container.querySelector('.add-line')).toBeTruthy();
      expect(container.querySelectorAll('.line-edit')).toHaveLength(2);
    });
  });
});
