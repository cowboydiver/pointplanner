// Per-viewer, per-map label display preferences (rotation angle + pivot point).
//
// Unlike most of what a map holds, how labels are oriented is a private display
// choice — like the dark theme and hide-labels toggles — not shared content. So
// it lives in localStorage keyed by map id rather than inside the saved MapData.
// Keeping it out of the document is what lets it work on read-only maps: GitHub
// mirrors (the preferred way to create a GitHub-backed map) and Viewer shares
// block all content edits, but a viewer can still re-orient the labels for their
// own session.
//
// Pure: takes a `Storage` double so it can be unit-tested without a browser,
// mirroring the localImport helpers in this directory. See ADR 0003.

const ANGLE_KEY_PREFIX = 'pointplanner.labelAngle.';
const PIVOT_KEY_PREFIX = 'pointplanner.labelPivot.';

/** Allowed rotation presets, in degrees. 0 = horizontal; ±45 = subway-style. */
export const LABEL_ANGLES = [0, 45, -45] as const;
export type LabelAngle = (typeof LABEL_ANGLES)[number];

/**
 * Allowed pivot points for the rotation. `center` spins the label about the
 * station marker (its origin); the rest pivot about an edge of the label's own
 * text box, so you can experiment with which anchor reads best.
 */
export const LABEL_PIVOTS = ['center', 'left', 'top', 'bottom', 'right'] as const;
export type LabelPivot = (typeof LABEL_PIVOTS)[number];

function isLabelAngle(n: number): n is LabelAngle {
  return (LABEL_ANGLES as readonly number[]).includes(n);
}

function isLabelPivot(s: string): s is LabelPivot {
  return (LABEL_PIVOTS as readonly string[]).includes(s);
}

/** Read the saved angle for a map; 0 when unset, malformed, or storage is unavailable. */
export function loadLabelAngle(storage: Pick<Storage, 'getItem'>, mapId: string): LabelAngle {
  try {
    const raw = storage.getItem(ANGLE_KEY_PREFIX + mapId);
    if (raw === null) return 0;
    const n = Number(raw);
    return isLabelAngle(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist the angle for a map. 0 clears the key so unrotated maps leave no trace. */
export function saveLabelAngle(storage: Pick<Storage, 'setItem' | 'removeItem'>, mapId: string, angle: number): void {
  try {
    if (angle === 0) storage.removeItem(ANGLE_KEY_PREFIX + mapId);
    else storage.setItem(ANGLE_KEY_PREFIX + mapId, String(angle));
  } catch {
    // Best-effort convenience: ignore quota / unavailable storage.
  }
}

/** Read the saved pivot for a map; `'center'` when unset, malformed, or unavailable. */
export function loadLabelPivot(storage: Pick<Storage, 'getItem'>, mapId: string): LabelPivot {
  try {
    const raw = storage.getItem(PIVOT_KEY_PREFIX + mapId);
    if (raw === null) return 'center';
    return isLabelPivot(raw) ? raw : 'center';
  } catch {
    return 'center';
  }
}

/** Persist the pivot for a map. `'center'` (the default) clears the key. */
export function saveLabelPivot(storage: Pick<Storage, 'setItem' | 'removeItem'>, mapId: string, pivot: string): void {
  try {
    if (pivot === 'center') storage.removeItem(PIVOT_KEY_PREFIX + mapId);
    else storage.setItem(PIVOT_KEY_PREFIX + mapId, pivot);
  } catch {
    // Best-effort convenience: ignore quota / unavailable storage.
  }
}
