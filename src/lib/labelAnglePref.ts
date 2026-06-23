// Per-viewer, per-map label-rotation preference.
//
// Unlike most of what a map holds, the label angle is a private display choice —
// like the dark theme and hide-labels toggles — not shared content. So it lives
// in localStorage keyed by map id rather than inside the saved MapData. Keeping
// it out of the document is what lets it work on read-only maps: GitHub mirrors
// (the preferred way to create a GitHub-backed map) and Viewer shares block all
// content edits, but a viewer can still rotate the labels for their own session.
//
// Pure: takes a `Storage` double so it can be unit-tested without a browser,
// mirroring the localImport helpers in this directory. See ADR 0003.

const KEY_PREFIX = 'pointplanner.labelAngle.';

/** Allowed rotation presets, in degrees. 0 = horizontal; 45 = subway-style. */
export const LABEL_ANGLES = [0, 45] as const;
export type LabelAngle = (typeof LABEL_ANGLES)[number];

function isLabelAngle(n: number): n is LabelAngle {
  return (LABEL_ANGLES as readonly number[]).includes(n);
}

/** Read the saved angle for a map; 0 when unset, malformed, or storage is unavailable. */
export function loadLabelAngle(storage: Pick<Storage, 'getItem'>, mapId: string): LabelAngle {
  try {
    const raw = storage.getItem(KEY_PREFIX + mapId);
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
    if (angle === 0) storage.removeItem(KEY_PREFIX + mapId);
    else storage.setItem(KEY_PREFIX + mapId, String(angle));
  } catch {
    // Best-effort convenience: ignore quota / unavailable storage.
  }
}
