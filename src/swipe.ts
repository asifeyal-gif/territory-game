import type { Direction } from './engine';

/** A gesture can contain several turns; release never repeats the last turn. */
export function bindSwipe(
  board: HTMLElement,
  turn: (direction: Direction) => void,
  enabled: () => boolean,
): { cancel: () => void; dispose: () => void } {
  let gesture: { id: number; x: number; y: number } | undefined;
  const end = (event?: PointerEvent) => {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    const id = gesture.id; gesture = undefined;
    if (board.hasPointerCapture(id)) board.releasePointerCapture(id);
  };
  const down = (event: PointerEvent) => {
    if (!enabled() || !event.isPrimary || gesture || event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.preventDefault();
    try { board.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!enabled()) { end(event); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
    // Avoid accidental turns from nearly diagonal hand jitter.
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 3) return;
    turn(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    gesture.x = event.clientX; gesture.y = event.clientY;
    event.preventDefault();
  };
  const reset = () => end();
  const visibility = () => { if (document.hidden) reset(); };
  board.addEventListener('pointerdown', down);
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
  board.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', visibility);
  return {cancel:reset,dispose: () => {
    end(); board.removeEventListener('pointerdown', down); board.removeEventListener('pointermove', move);
    board.removeEventListener('pointerup', end); board.removeEventListener('pointercancel', end);
    board.removeEventListener('lostpointercapture', end); window.removeEventListener('blur', reset);
    document.removeEventListener('visibilitychange', visibility);
  }};
}
