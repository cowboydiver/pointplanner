import { useMemo } from 'react';
import { useStore } from '../../store/projectStore';
import { applyLineFilter, buildBoardModel, type BoardModel, type LineFilterMode } from '../../lib/board';

/**
 * The board model for the active map, narrowed to the legend's selected line.
 * Every board reads the model through here, so selecting a line in the legend
 * filters all three the same way it filters the map — see ADR 0010.
 */
export function useBoardModel(): BoardModel {
  const { state, indexes } = useStore();
  return useMemo(
    () => applyLineFilter(
      buildBoardModel(state.stations, state.lines, indexes),
      state.highlightLine,
      state.boardLineFilter,
    ),
    [state.stations, state.lines, indexes, state.highlightLine, state.boardLineFilter],
  );
}

export interface LineFilter {
  /** The line every board is narrowed to, or null when showing the whole map. */
  lineId: string | null;
  mode: LineFilterMode;
  setMode: (mode: LineFilterMode) => void;
  clear: () => void;
}

/** The active line filter, for the chrome that displays and changes it. */
export function useLineFilter(): LineFilter {
  const { state, dispatch } = useStore();
  return {
    lineId: state.highlightLine,
    mode: state.boardLineFilter,
    setMode: mode => dispatch({ type: 'SET_BOARD_LINE_FILTER', mode }),
    clear: () => dispatch({ type: 'SET_HIGHLIGHT_LINE', lineId: null }),
  };
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
