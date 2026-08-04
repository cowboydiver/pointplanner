// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// Holds the "am I looking at the map or the board?" flag for the Board View
// prototype. It lives in a context rather than in the real store reducer so the
// prototype deletes cleanly: remove this directory plus three lines each in
// App.tsx and Topbar.tsx.

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { readParam, writeParam } from './urlParams';

interface BoardViewValue {
  boardOpen: boolean;
  toggleBoard: () => void;
}

const BoardViewContext = createContext<BoardViewValue>({
  boardOpen: false,
  toggleBoard: () => {},
});

export function BoardViewProvider({ children }: { children: ReactNode }) {
  const [boardOpen, setBoardOpen] = useState(() => readParam('view') === 'board');

  const toggleBoard = useCallback(() => {
    setBoardOpen(open => {
      const next = !open;
      writeParam('view', next ? 'board' : 'map');
      return next;
    });
  }, []);

  return (
    <BoardViewContext.Provider value={{ boardOpen, toggleBoard }}>
      {children}
    </BoardViewContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBoardView(): BoardViewValue {
  return useContext(BoardViewContext);
}
