import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { IDENTITY, panBy, zoomAt, type ViewTransform } from '../lib/panzoom';

/** Convert client (screen) coordinates to the SVG's viewBox coordinate space. */
function clientToViewBox(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// Smaller = gentler wheel zoom. Exponential keeps zoom steps even across scales.
const WHEEL_SENSITIVITY = 0.0015;
const BUTTON_STEP = 1.3;

export interface PanZoomControls {
  transform: ViewTransform;
  isPanning: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

/**
 * Wheel-to-zoom (anchored at the cursor) and pointer-drag panning for an SVG
 * map. The wheel listener is attached natively as non-passive so it can
 * preventDefault the page scroll/browser zoom.
 */
export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>): PanZoomControls {
  const [transform, setTransform] = useState<ViewTransform>(IDENTITY);
  const [isPanning, setIsPanning] = useState(false);
  // Last pointer position in viewBox units, or null when not dragging.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const el = svgRef.current;
      if (!el) return;
      const p = clientToViewBox(el, e.clientX, e.clientY);
      if (!p) return;
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      setTransform(t => zoomAt(t, factor, p.x, p.y));
    }
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const el = svgRef.current;
      if (!el || !lastPoint.current) return;
      const p = clientToViewBox(el, e.clientX, e.clientY);
      if (!p) return;
      const dx = p.x - lastPoint.current.x;
      const dy = p.y - lastPoint.current.y;
      lastPoint.current = p;
      setTransform(t => panBy(t, dx, dy));
    }
    function onUp() {
      if (!lastPoint.current) return;
      lastPoint.current = null;
      setIsPanning(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [svgRef]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return; // left button / primary touch only
    const el = svgRef.current;
    if (!el) return;
    const p = clientToViewBox(el, e.clientX, e.clientY);
    if (!p) return;
    lastPoint.current = p;
    setIsPanning(true);
  }, [svgRef]);

  const zoomByButton = useCallback((factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = clientToViewBox(el, r.left + r.width / 2, r.top + r.height / 2);
    if (!p) return;
    setTransform(t => zoomAt(t, factor, p.x, p.y));
  }, [svgRef]);

  const zoomIn = useCallback(() => zoomByButton(BUTTON_STEP), [zoomByButton]);
  const zoomOut = useCallback(() => zoomByButton(1 / BUTTON_STEP), [zoomByButton]);
  const reset = useCallback(() => setTransform(IDENTITY), []);

  return { transform, isPanning, onPointerDown, zoomIn, zoomOut, reset };
}
