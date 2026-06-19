import type { Project, Line, Station, Edge } from './types';

/**
 * The render-ready PointPlanner map the generator emits. Vendored (trimmed to
 * just this type) from PointPlanner `src/lib/maps.ts` so the skill carries no
 * dependency on the host app's source.
 */
export interface MapData {
  project: Project;
  lines: Line[];
  stations: Station[];
  edges: Edge[];
}
