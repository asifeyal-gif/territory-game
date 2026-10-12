import type { Direction } from './engine';

/** One deliberate turn per contact. Native touch listeners keep Safari from panning. */
export function bindSwipe(
  board: HTMLElement,
  turn: (direction: Direction) => void,
  enabled: () => boolean,
): { cancel: () => void; dispose: () => void } {
  let gesture: { source: 'touch' | 'pointer'; id: number; x: number; y: number; sent: boolean } | undefined;
  const cancel = () => {
    const previous = gesture; gesture = undefined;
    if (previous?.source === 'pointer' && board.hasPointerCapture(previous.id)) board.releasePointerCapture(previous.id);
  };
  const move = (x: number, y: number) => {
    if (!gesture) return;
    if (!enabled()) { cancel(); return; }
    if (gesture.sent) return;
    const dx = x - gesture.x, dy = y - gesture.y;
    const major = Math.max(Math.abs(dx), Math.abs(dy)), minor = Math.min(Math.abs(dx), Math.abs(dy));
    if (major < 18 || major < minor * 1.25) return;
    gesture.sent = true;
    turn(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !enabled() || !event.isPrimary || gesture || event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
    gesture = { source: 'pointer', id: event.pointerId, x: event.clientX, y: event.clientY, sent: false };
    event.preventDefault();
    try { board.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
  };
  const pointerMove = (event: PointerEvent) => {
    if (gesture?.source !== 'pointer' || gesture.id !== event.pointerId) return;
    event.preventDefault(); move(event.clientX, event.clientY);
  };
  const pointerEnd = (event: PointerEvent) => {
    if (gesture?.source === 'pointer' && gesture.id === event.pointerId) cancel();
  };
  const touchStart = (event: TouchEvent) => {
    if (!enabled() || gesture || event.touches.length !== 1 || !(event.target instanceof HTMLCanvasElement)) return;
    const finger = event.changedTouches[0];
    if (!finger) return;
    gesture = { source: 'touch', id: finger.identifier, x: finger.clientX, y: finger.clientY, sent: false };
    event.preventDefault();
  };
  const touchMove = (event: TouchEvent) => {
    if (gesture?.source !== 'touch') return;
    event.preventDefault();
    const finger = Array.from(event.touches).find(finger => finger.identifier === gesture!.id);
    if (finger) move(finger.clientX, finger.clientY);
  };
  const touchEnd = (event: TouchEvent) => {
    if (gesture?.source === 'touch' && Array.from(event.changedTouches).some(finger => finger.identifier === gesture!.id)) cancel();
  };
  const touchCancel = () => { if (gesture?.source === 'touch') cancel(); };
  const visibility = () => { if (document.hidden) cancel(); };
  board.addEventListener('pointerdown', down);
  board.addEventListener('pointermove', pointerMove);
  board.addEventListener('pointerup', pointerEnd);
  board.addEventListener('pointercancel', pointerEnd);
  board.addEventListener('lostpointercapture', pointerEnd);
  board.addEventListener('touchstart', touchStart, { passive: false });
  document.addEventListener('touchmove', touchMove, { passive: false });
  document.addEventListener('touchend', touchEnd);
  document.addEventListener('touchcancel', touchCancel);
  document.addEventListener('visibilitychange', visibility);
  return { cancel, dispose: () => {
    cancel(); board.removeEventListener('pointerdown', down); board.removeEventListener('pointermove', pointerMove);
    board.removeEventListener('pointerup', pointerEnd); board.removeEventListener('pointercancel', pointerEnd);
    board.removeEventListener('lostpointercapture', pointerEnd); board.removeEventListener('touchstart', touchStart);
    document.removeEventListener('touchmove', touchMove); document.removeEventListener('touchend', touchEnd);
    document.removeEventListener('touchcancel', touchCancel); document.removeEventListener('visibilitychange', visibility);
  }};
}
