/**
 * Wrap a station label into at most `maxLines` lines for SVG rendering. SVG
 * `<text>` has no automatic wrapping, so we pre-split here and the component
 * emits one `<tspan>` per line.
 *
 * Greedy word packing: words are kept whole (never split mid-word) and packed
 * onto a line until adding the next word would exceed `maxChars`. When the result
 * would spill past `maxLines`, the remaining words are collapsed onto the last
 * allowed line and truncated with an ellipsis so the label stays bounded.
 *
 * Pure and measurement-free (char-count heuristic), so it's deterministic and
 * unit-testable without a DOM.
 */
export function wrapLabel(
  name: string,
  maxChars = 18,
  maxLines = 2,
): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  // Overflow: keep the first maxLines-1 lines, cram the rest into the last one
  // and ellipsize on a character boundary.
  const kept = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join(' ');
  const slice = rest.slice(0, Math.max(0, maxChars - 1));
  const trimmed = slice.replace(/\s+\S*$/, '') || slice;
  kept.push(trimmed.replace(/[\s.,;:]+$/, '') + '…');
  return kept;
}
