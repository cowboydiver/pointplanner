export interface Line {
  id: string;
  name: string;
  color: string;
  short: string;
}

export type StationStatus = 'locked' | 'available' | 'active' | 'done';
export type LabelPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface Station {
  id: string;
  name: string;
  lines: string[];
  col: number;
  row: number;
  lp: LabelPlacement;
  status: StationStatus;
  desc: string;
  owner: string;
  role: string;
  due: string;
  est: string;
  tags: string[];
  /** Optional link back to the source (e.g. a GitHub issue's HTML URL). */
  sourceUrl?: string;
}

export interface Edge {
  from: string;
  to: string;
  line: string;
  df?: boolean;
}

export interface Project {
  name: string;
  subtitle: string;
}
