import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Edge, Line, Station } from '../../types';
import type { MapData } from '../../lib/maps';

// Real store, real legend, real boards — only the I/O boundary is mocked, so
// the legend's SET_HIGHLIGHT_LINE reaches the boards exactly as it does live.
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
import { Legend } from '../Legend';
import { ViewSwitcher } from '../ViewSwitcher';
import { BoardView } from './BoardView';

const LINES: Line[] = [
  { id: 'design', name: 'Design Line', color: '#D8392F', short: 'DS' },
  { id: 'build', name: 'Build Line', color: '#2563C9', short: 'BD' },
];

function station(
  id: string,
  col: number,
  status: Station['status'],
  lines: string[] = ['design'],
): Station {
  return {
    id, name: id, lines, col, row: 0, lp: 'top', status,
    desc: 'd', owner: 'o', role: '', due: '—', est: '—', tags: [],
  };
}

// Two lines that meet at an interchange, with something in every status group
// on each, so a filter has both matches and exclusions to act on.
function makeData(): MapData {
  const stations = [
    station('design-done', 0, 'done'),
    station('design-ready', 1, 'available'),
    station('interchange', 2, 'locked', ['design', 'build']),
    station('build-ready', 1, 'available', ['build']),
    station('build-active', 2, 'active', ['build']),
  ];
  const edges: Edge[] = [
    { from: 'design-done', to: 'design-ready', line: 'design' },
    { from: 'design-ready', to: 'interchange', line: 'design' },
  ];
  return { project: { name: 'P', subtitle: 'S' }, lines: LINES, stations, edges };
}

async function renderApp() {
  loadMap.mockResolvedValue({
    id: 'm1', name: 'Test', data: makeData(), version: 1, role: 'owner', isMirror: false,
  });
  const utils = render(
    <ProjectStoreProvider mapId="m1">
      <Legend />
      <ViewSwitcher />
      <BoardView />
    </ProjectStoreProvider>,
  );
  await waitFor(() => expect(utils.container.querySelector('.lines-list')).toBeTruthy());
  return utils;
}

function showView(container: HTMLElement, label: string) {
  const seg = [...container.querySelectorAll<HTMLButtonElement>('.view-seg')].find(
    b => b.textContent === label,
  );
  if (!seg) throw new Error(`no "${label}" segment`);
  fireEvent.click(seg);
}

/** Click a line in the legend, the same control the map filters from. */
function selectLine(container: HTMLElement, name: string) {
  const row = [...container.querySelectorAll<HTMLButtonElement>('.line-row-btn')].find(
    b => b.textContent?.includes(name),
  );
  if (!row) throw new Error(`no "${name}" line row`);
  fireEvent.click(row);
}

function setMode(container: HTMLElement, label: string) {
  const seg = [...container.querySelectorAll<HTMLButtonElement>('.filter-seg')].find(
    b => b.textContent === label,
  );
  if (!seg) throw new Error(`no "${label}" filter mode`);
  fireEvent.click(seg);
}

// Match on each board's name element rather than on card text, so a locked
// card's "waiting on <name>" note doesn't read as the named station itself.
const NAME_SELECTOR =
  '.q-name, .q-row-name, .col-tile-name, .col-pill-name, .col-card-name, .dep-name, .stop-name, .stop-tick-name';
const CARD_SELECTOR = '.q-card, .q-row, .col-tile, .col-pill, .col-card, .dep-row, .stop';

/** Board rows/cards/stops naming a station, whatever the board's own markup. */
function cardsFor(container: HTMLElement, name: string): Element[] {
  return [...container.querySelectorAll(NAME_SELECTOR)]
    .filter(el => el.textContent?.trim() === name)
    .map(el => el.closest(CARD_SELECTOR))
    .filter((el): el is Element => el !== null);
}

const VIEWS = ['Queue', 'Board', 'Departures'];

describe('line filtering on the boards', () => {
  beforeEach(() => loadMap.mockReset());

  it.each(VIEWS)('%s fades the stations off the selected line by default', async view => {
    const { container } = await renderApp();
    showView(container, view);
    await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

    selectLine(container, 'Design Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());

    // Off-line stations are still on the board, faded…
    const off = cardsFor(container, 'build-ready');
    expect(off.length).toBeGreaterThan(0);
    expect(off.every(el => el.classList.contains('dim'))).toBe(true);

    // …and the ones the line serves are untouched.
    const on = cardsFor(container, 'design-ready');
    expect(on.length).toBeGreaterThan(0);
    expect(on.some(el => el.classList.contains('dim'))).toBe(false);
  });

  it.each(VIEWS)('%s removes them entirely in hide mode', async view => {
    const { container } = await renderApp();
    showView(container, view);
    await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

    selectLine(container, 'Design Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());
    setMode(container, 'Hide');

    await waitFor(() => expect(cardsFor(container, 'build-ready')).toHaveLength(0));
    expect(cardsFor(container, 'build-active')).toHaveLength(0);
    expect(cardsFor(container, 'design-ready').length).toBeGreaterThan(0);
    // Nothing that survives a hide is dimmed — the two modes never mix.
    expect(container.querySelectorAll('.board .dim')).toHaveLength(0);
  });

  it.each(VIEWS)('%s keeps an interchange the filtered line serves', async view => {
    const { container } = await renderApp();
    showView(container, view);
    await waitFor(() => expect(container.querySelector('.board')).toBeTruthy());

    selectLine(container, 'Build Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());
    setMode(container, 'Hide');

    await waitFor(() => expect(cardsFor(container, 'design-ready')).toHaveLength(0));
    expect(cardsFor(container, 'interchange').length).toBeGreaterThan(0);
  });

  it('shows no filter bar until a line is selected, and clears back to everything', async () => {
    const { container } = await renderApp();
    showView(container, 'Queue');
    await waitFor(() => expect(container.querySelector('.board-queue')).toBeTruthy());
    expect(container.querySelector('.filter-bar')).toBeNull();

    selectLine(container, 'Design Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());
    // 2 of the 5 stations sit on the Design Line's ready/locked groups plus the
    // done one; the bar reports the line against the whole map.
    expect(container.querySelector('.filter-bar')!.textContent).toContain('3 of 5 stations');

    fireEvent.click(container.querySelector<HTMLButtonElement>('.filter-clear')!);
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeNull());
    expect(container.querySelectorAll('.board .dim')).toHaveLength(0);
    expect(cardsFor(container, 'build-ready').length).toBeGreaterThan(0);
  });

  it('collapses Departures to the filtered lane in hide mode, and keeps both in fade', async () => {
    const { container } = await renderApp();
    showView(container, 'Departures');
    await waitFor(() => expect(container.querySelector('.board-dep')).toBeTruthy());
    expect(container.querySelectorAll('.lane')).toHaveLength(2);

    selectLine(container, 'Design Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());
    // Fade keeps both lanes; only the off-filter one is dimmed.
    expect(container.querySelectorAll('.lane')).toHaveLength(2);
    expect(container.querySelectorAll('.lane.dim')).toHaveLength(1);

    setMode(container, 'Hide');
    await waitFor(() => expect(container.querySelectorAll('.lane')).toHaveLength(1));
    expect(container.querySelectorAll('.lane.dim')).toHaveLength(0);
  });

  it('re-counts the Queue header around the line in hide mode', async () => {
    const { container } = await renderApp();
    showView(container, 'Queue');
    await waitFor(() => expect(container.querySelector('.board-queue')).toBeTruthy());
    expect(container.querySelector('.q-sub')!.textContent).toContain('of 5 stations');

    selectLine(container, 'Design Line');
    await waitFor(() => expect(container.querySelector('.filter-bar')).toBeTruthy());
    // Fade changes nothing about the counts — every station is still on screen.
    expect(container.querySelector('.q-sub')!.textContent).toContain('of 5 stations');

    setMode(container, 'Hide');
    await waitFor(() =>
      expect(container.querySelector('.q-sub')!.textContent).toContain('of 3 stations'),
    );
  });
});
