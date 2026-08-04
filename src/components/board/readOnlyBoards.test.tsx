import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Edge, Line, Station } from '../../types';
import type { MapData } from '../../lib/maps';
import type { MapRole } from '../../data/mapsRepo';

// Real store + real boards; only the I/O boundary is mocked, so the read-only
// guard in projectStore runs exactly as it does live. A read-only store also
// subscribes to Realtime, hence the channel stub.
vi.mock('../../data/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

const loadMap = vi.fn();
vi.mock('../../data/mapsRepo', () => ({
  loadMap: (id: string) => loadMap(id),
  saveMap: async () => ({ ok: true, version: 2 }),
  getMapSource: async () => null,
}));

vi.mock('../../store/mapRegistry', () => ({
  useMapRegistry: () => ({ reloadActiveMap: vi.fn(), activeMeta: { id: 'm1', name: 'Test' } }),
}));

import { ProjectStoreProvider } from '../../store/projectStore';
import { ViewSwitcher } from '../ViewSwitcher';
import { DetailPanel } from '../DetailPanel';
import { BoardView } from './BoardView';

const LINES: Line[] = [{ id: 'l', name: 'Line', color: '#2563C9', short: 'L' }];

function station(id: string, col: number, status: Station['status']): Station {
  return {
    id, name: id, lines: ['l'], col, row: 0, lp: 'top', status,
    desc: 'd', owner: 'o', role: '', due: '—', est: '—', tags: [],
  };
}

// design (done) -> build (available) -> ship (locked), plus copy (active), so
// every board has something in all four status groups.
function makeData(): MapData {
  const stations = [
    station('design', 0, 'done'),
    station('build', 1, 'available'),
    station('ship', 2, 'locked'),
    station('copy', 3, 'active'),
  ];
  const edges: Edge[] = [
    { from: 'design', to: 'build', line: 'l' },
    { from: 'build', to: 'ship', line: 'l' },
  ];
  return { project: { name: 'P', subtitle: 'S' }, lines: LINES, stations, edges };
}

async function renderBoards() {
  const utils = render(
    <ProjectStoreProvider mapId="m1">
      <ViewSwitcher />
      <BoardView />
      <DetailPanel />
    </ProjectStoreProvider>,
  );
  await waitFor(() => expect(utils.container.querySelector('.view-switcher')).toBeTruthy());
  return utils;
}

function showView(container: HTMLElement, label: string) {
  const seg = [...container.querySelectorAll<HTMLButtonElement>('.view-seg')].find(
    b => b.textContent === label,
  );
  if (!seg) throw new Error(`no "${label}" segment`);
  fireEvent.click(seg);
  return seg;
}

/** Every control that would advance a station's status, across all three boards. */
function statusControls(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.board button')].filter(b =>
    /^(Start|Mark complete|Arrive)$/.test(b.textContent ?? ''),
  );
}

function mount(role: MapRole, isMirror: boolean) {
  loadMap.mockResolvedValue({
    id: 'm1', name: 'Test', data: makeData(), version: 1, role, isMirror,
  });
}

describe('boards on read-only maps', () => {
  beforeEach(() => {
    loadMap.mockReset();
  });

  // Both flavours of read-only: a Viewer share and a GitHub mirror.
  const readOnlyCases: [string, MapRole, boolean][] = [
    ['a Viewer share', 'viewer', false],
    ['a GitHub mirror', 'owner', true],
  ];

  for (const [name, role, isMirror] of readOnlyCases) {
    describe(name, () => {
      beforeEach(() => mount(role, isMirror));

      it('switches views — SET_VIEW is not blocked by the read-only guard', async () => {
        const { container } = await renderBoards();

        // `map` is the default, and BoardView renders nothing for it.
        expect(container.querySelector('.board')).toBeNull();

        showView(container, 'Queue');
        await waitFor(() => expect(container.querySelector('.board-queue')).toBeTruthy());

        showView(container, 'Board');
        await waitFor(() => expect(container.querySelector('.board-cols')).toBeTruthy());

        showView(container, 'Departures');
        await waitFor(() => expect(container.querySelector('.board-dep')).toBeTruthy());

        showView(container, 'Map');
        await waitFor(() => expect(container.querySelector('.board')).toBeNull());
      });

      it.each(['Queue', 'Board', 'Departures'])(
        '%s renders the stations but offers no status controls',
        async view => {
          const { container } = await renderBoards();
          showView(container, view);
          await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

          // The available station is on screen…
          expect(container.textContent).toContain('build');
          // …but nothing can advance it.
          expect(statusControls(container)).toHaveLength(0);
        },
      );

      it('still opens the detail panel — OPEN_DETAIL is view-only', async () => {
        const { container } = await renderBoards();
        showView(container, 'Queue');
        await waitFor(() => expect(container.querySelector('.q-card-ready')).toBeTruthy());

        fireEvent.click(container.querySelector('.q-card-ready')!);
        await waitFor(() => expect(container.querySelector('.detail.open')).toBeTruthy());
      });
    });
  }

  describe('an editable map', () => {
    beforeEach(() => mount('owner', false));

    it.each(['Queue', 'Board', 'Departures'])(
      '%s does offer status controls, so the read-only assertions mean something',
      async view => {
        const { container } = await renderBoards();
        showView(container, view);
        await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

        expect(statusControls(container).length).toBeGreaterThan(0);
      },
    );

    it('an Editor share is not read-only', async () => {
      mount('editor', false);
      const { container } = await renderBoards();
      showView(container, 'Queue');
      await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

      expect(statusControls(container).length).toBeGreaterThan(0);
    });
  });
});
