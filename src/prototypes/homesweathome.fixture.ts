/**
 * PROTOTYPE FIXTURE — wipe me.
 *
 * Snapshot of the `cowboydiver/homesweathome` mirror map (35 stations / 50 edges
 * / 6 lines) pulled from Supabase on 2026-06-23. Used only by
 * `MapClutterPrototype` so the clutter variants render against a real, dense map
 * instead of a toy graph. Not wired into the app; delete with the prototype.
 */
import type { Edge, Line, Station } from '../types';

export const FIXTURE_LINES: Line[] = [
  { id: 'v0-4-floor-plan', name: 'v0.4 — Floor Plan', color: '#D8392F', short: 'V4' },
  { id: 'v0-5-capture-imaging', name: 'v0.5 — Capture & Imaging', color: '#2563C9', short: 'V5' },
  { id: 'v0-6-ad-copy-export', name: 'v0.6 — Ad Copy & Export', color: '#1E9C55', short: 'V6' },
  { id: 'v1-0-acceptance-polish', name: 'v1.0 — Acceptance & Polish', color: '#E0962A', short: 'V0' },
  { id: 'v2-0-post-mvp-future', name: 'v2.0 — Post-MVP / Future', color: '#7A4DD0', short: 'VA' },
  { id: 'backlog', name: 'Backlog', color: '#0E9AA7', short: 'BA' },
];

// Only the fields the prototype renderer reads; the rest of the Station shape is
// filled with harmless defaults so this satisfies the real Station type.
type Seed = Pick<Station, 'id' | 'name' | 'col' | 'row' | 'lp' | 'status' | 'lines'>;

const SEEDS: Seed[] = [
  { id: 'issue-56', name: '#56 Edit Fixed Inventory & furniture symbols', col: 3, row: 6, lp: 'bottom', status: 'locked', lines: ['v0-4-floor-plan'] },
  { id: 'issue-55', name: '#55 Rename a room (first edit interaction)', col: 2, row: 8, lp: 'bottom', status: 'locked', lines: ['v0-4-floor-plan'] },
  { id: 'issue-54', name: '#54 Per-room geometry + tap-to-focus a room', col: 1, row: 8, lp: 'bottom', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-53', name: '#53 Pinch-zoom & pan', col: 1, row: 9, lp: 'bottom', status: 'done', lines: ['v0-4-floor-plan'] },
  { id: 'issue-52', name: '#52 Vector SwiftUI render replaces the PDF', col: 0, row: 0, lp: 'top', status: 'done', lines: ['v0-4-floor-plan'] },
  { id: 'issue-51', name: '#51 Epic: Floor Plan becomes a vector graphic', col: 4, row: 0, lp: 'top', status: 'locked', lines: ['v0-4-floor-plan'] },
  { id: 'issue-48', name: '#48 North arrow, un-mirror plan, debug overlay', col: 0, row: 1, lp: 'top', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-45', name: '#45 Clean up wall outline on multi-room plans', col: 0, row: 2, lp: 'top', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-43', name: '#43 Scan: Næste rum timing is unguided', col: 0, row: 3, lp: 'bottom', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-39', name: '#39 Verify walls/label world-frame alignment', col: 2, row: 2, lp: 'top', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-32', name: '#32 Wire the vector Floor Plan into Export Bundle', col: 3, row: 1, lp: 'top', status: 'locked', lines: ['v0-6-ad-copy-export'] },
  { id: 'issue-31', name: '#31 Chrome as a vector overlay', col: 2, row: 1, lp: 'top', status: 'available', lines: ['v0-4-floor-plan'] },
  { id: 'issue-30', name: '#30 Fixed Inventory in the editable Draft', col: 1, row: 2, lp: 'top', status: 'done', lines: ['v0-4-floor-plan'] },
  { id: 'issue-29', name: '#29 Doors + windows as opening symbols', col: 1, row: 10, lp: 'bottom', status: 'done', lines: ['v0-4-floor-plan'] },
  { id: 'issue-28', name: '#28 Danish room labels + m² per room', col: 1, row: 11, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-27', name: '#27 Wall outline derived from Captured Structure', col: 0, row: 4, lp: 'bottom', status: 'done', lines: ['v0-4-floor-plan'] },
  { id: 'issue-20', name: '#20 Working-set memory verification + DNG teardown', col: 5, row: 3, lp: 'bottom', status: 'locked', lines: ['v0-5-capture-imaging'] },
  { id: 'issue-19', name: '#19 Conservative edit pipeline rewrite', col: 4, row: 5, lp: 'bottom', status: 'locked', lines: ['v0-5-capture-imaging'] },
  { id: 'issue-18', name: '#18 Window-protection mask projection', col: 3, row: 8, lp: 'bottom', status: 'available', lines: ['v0-5-capture-imaging'] },
  { id: 'issue-17', name: '#17 CIRAWFilter decode + 8-bit JPEG tone-map', col: 0, row: 5, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-16', name: '#16 Configure AVCapturePhotoOutput for DNG capture', col: 0, row: 7, lp: 'bottom', status: 'available', lines: ['v0-5-capture-imaging'] },
  { id: 'issue-14', name: '#14 13: Acceptance - real semi-detached house run', col: 5, row: 5, lp: 'bottom', status: 'locked', lines: ['v1-0-acceptance-polish'] },
  { id: 'issue-13', name: '#13 12: Export bundler + share sheet', col: 4, row: 2, lp: 'top', status: 'done', lines: ['backlog'] },
  { id: 'issue-12', name: '#12 11: AR-guided capture', col: 3, row: 10, lp: 'bottom', status: 'available', lines: ['v0-5-capture-imaging'] },
  { id: 'issue-11', name: '#11 10: HTTP text service client + fallback dialog', col: 3, row: 2, lp: 'top', status: 'locked', lines: ['v0-6-ad-copy-export'] },
  { id: 'issue-10', name: '#10 9: Floor plan PDF renderer', col: 3, row: 11, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-9', name: '#9 8: RoomPlan MultiRoom scan + persistence', col: 2, row: 11, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-8', name: '#8 7: Image-edit pipeline + EditReviewView', col: 2, row: 12, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-7', name: '#7 6: PinHeuristic + RoomGeometry math', col: 2, row: 13, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-6', name: '#6 5: Mock text service + adapter', col: 2, row: 14, lp: 'bottom', status: 'available', lines: ['v0-6-ad-copy-export'] },
  { id: 'issue-5', name: '#5 4: Onboarding screens', col: 1, row: 7, lp: 'bottom', status: 'available', lines: ['v1-0-acceptance-polish'] },
  { id: 'issue-4', name: '#4 3: Spike - ARSession reuse (Path A vs B)', col: 1, row: 12, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-3', name: '#3 2: Domain types + on-disk ListingStore', col: 1, row: 6, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-2', name: '#2 1: End-to-end skeleton', col: 0, row: 6, lp: 'bottom', status: 'done', lines: ['backlog'] },
  { id: 'issue-1', name: '#1 PRD: homesweathome iOS MVP', col: 6, row: 4, lp: 'bottom', status: 'locked', lines: ['v1-0-acceptance-polish'] },
];

export const FIXTURE_STATIONS: Station[] = SEEDS.map(s => ({
  ...s,
  desc: '', owner: 'Unassigned', role: '', due: '—', est: '—', tags: [],
}));

export const FIXTURE_EDGES: Edge[] = [
  { from: 'issue-16', to: 'issue-1', line: 'v1-0-acceptance-polish' },
  { from: 'issue-17', to: 'issue-1', line: 'v1-0-acceptance-polish' },
  { from: 'issue-18', to: 'issue-1', line: 'v1-0-acceptance-polish' },
  { from: 'issue-19', to: 'issue-1', line: 'v1-0-acceptance-polish' },
  { from: 'issue-20', to: 'issue-1', line: 'v1-0-acceptance-polish' },
  { from: 'issue-2', to: 'issue-3', line: 'backlog' },
  { from: 'issue-2', to: 'issue-4', line: 'backlog' },
  { from: 'issue-2', to: 'issue-5', line: 'v1-0-acceptance-polish' },
  { from: 'issue-3', to: 'issue-6', line: 'v0-6-ad-copy-export' },
  { from: 'issue-3', to: 'issue-7', line: 'backlog' },
  { from: 'issue-3', to: 'issue-8', line: 'backlog' },
  { from: 'issue-3', to: 'issue-9', line: 'backlog' },
  { from: 'issue-4', to: 'issue-9', line: 'backlog' },
  { from: 'issue-9', to: 'issue-10', line: 'backlog' },
  { from: 'issue-6', to: 'issue-11', line: 'v0-6-ad-copy-export' },
  { from: 'issue-4', to: 'issue-12', line: 'v0-5-capture-imaging' },
  { from: 'issue-7', to: 'issue-12', line: 'v0-5-capture-imaging' },
  { from: 'issue-9', to: 'issue-12', line: 'v0-5-capture-imaging' },
  { from: 'issue-8', to: 'issue-13', line: 'backlog' },
  { from: 'issue-10', to: 'issue-13', line: 'backlog' },
  { from: 'issue-11', to: 'issue-13', line: 'backlog' },
  { from: 'issue-5', to: 'issue-14', line: 'v1-0-acceptance-polish' },
  { from: 'issue-12', to: 'issue-14', line: 'v1-0-acceptance-polish' },
  { from: 'issue-13', to: 'issue-14', line: 'v1-0-acceptance-polish' },
  { from: 'issue-7', to: 'issue-18', line: 'v0-5-capture-imaging' },
  { from: 'issue-16', to: 'issue-19', line: 'v0-5-capture-imaging' },
  { from: 'issue-17', to: 'issue-19', line: 'v0-5-capture-imaging' },
  { from: 'issue-18', to: 'issue-19', line: 'v0-5-capture-imaging' },
  { from: 'issue-16', to: 'issue-20', line: 'v0-5-capture-imaging' },
  { from: 'issue-19', to: 'issue-20', line: 'v0-5-capture-imaging' },
  { from: 'issue-27', to: 'issue-28', line: 'backlog' },
  { from: 'issue-27', to: 'issue-29', line: 'v0-4-floor-plan' },
  { from: 'issue-52', to: 'issue-30', line: 'v0-4-floor-plan' },
  { from: 'issue-30', to: 'issue-31', line: 'v0-4-floor-plan' },
  { from: 'issue-52', to: 'issue-31', line: 'v0-4-floor-plan' },
  { from: 'issue-31', to: 'issue-32', line: 'v0-6-ad-copy-export' },
  { from: 'issue-28', to: 'issue-39', line: 'v0-4-floor-plan' },
  { from: 'issue-30', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-31', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-32', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-52', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-53', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-54', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-55', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-56', to: 'issue-51', line: 'v0-4-floor-plan' },
  { from: 'issue-52', to: 'issue-53', line: 'v0-4-floor-plan' },
  { from: 'issue-52', to: 'issue-54', line: 'v0-4-floor-plan' },
  { from: 'issue-54', to: 'issue-55', line: 'v0-4-floor-plan' },
  { from: 'issue-30', to: 'issue-56', line: 'v0-4-floor-plan' },
  { from: 'issue-55', to: 'issue-56', line: 'v0-4-floor-plan' },
];
