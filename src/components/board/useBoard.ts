import { useMemo } from 'react';
import { useStore } from '../../store/projectStore';
import { buildBoardModel, type BoardModel } from '../../lib/board';

/** The board model for the active map, rebuilt only when the graph changes. */
export function useBoardModel(): BoardModel {
  const { state, indexes } = useStore();
  return useMemo(
    () => buildBoardModel(state.stations, state.lines, indexes),
    [state.stations, state.lines, indexes],
  );
}

export interface BoardActions {
  /** True for a Viewer share or a GitHub mirror — status controls are hidden. */
  readOnly: boolean;
  select: (id: string) => void;
  start: (id: string) => void;
  complete: (id: string) => void;
}

/**
 * The only things a board can do: open a station's detail panel, or advance its
 * status. Both go through the existing store actions, so `recompute` cascades
 * exactly as it does from the map.
 */
export function useBoardActions(): BoardActions {
  const { dispatch, readOnly } = useStore();
  return {
    readOnly,
    select: id => dispatch({ type: 'OPEN_DETAIL', id }),
    start: id => dispatch({ type: 'DO_ACTION', id, act: 'start' }),
    complete: id => dispatch({ type: 'DO_ACTION', id, act: 'done' }),
  };
}
