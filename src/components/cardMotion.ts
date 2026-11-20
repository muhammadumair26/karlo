import { useEffect, useLayoutEffect, useRef } from 'react';
import type { BoardData } from '../lib/types';

/* Trello-style card motion for the board:
   - every card glides to its new place whenever the board's layout changes (a drop, a gap opening
     for a dragged card, someone else moving a card), instead of jumping;
   - on touch screens a card is picked up with a short press: it lifts and tilts, follows the finger,
     the board scrolls when the finger nears an edge, and on release it settles into its slot. */

const EASE = 'cubic-bezier(.2,.9,.3,1)';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where a card sits on the board, independent of how far the board or its list is scrolled. */
function boardPos(el: HTMLElement, canvas: HTMLElement, r = el.getBoundingClientRect()) {
  const lc = el.closest('.list-cards') as HTMLElement | null;
  return { x: r.left + canvas.scrollLeft, y: r.top + (lc?.scrollTop ?? 0) };
}

/** Animate cards from where they were to where they are now, after every render. */
export function useCardFlip(canvasRef: React.RefObject<HTMLDivElement | null>) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const animate = !reduced();
    const next = new Map<string, { x: number; y: number }>();
    const moved: [HTMLElement, number, number][] = [];
    canvas.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
      const id = el.dataset.cardId!;
      if (el.offsetParent === null) return; // hidden (picked up)
      // A card still gliding starts its next glide from where it is on screen right now.
      const visual = el.style.transform ? boardPos(el, canvas) : null;
      el.style.transition = 'none';
      el.style.transform = '';
      const p = boardPos(el, canvas);
      next.set(id, p);
      const old = visual ?? prev.current.get(id);
      if (!animate || !old) return;
      const dx = old.x - p.x;
      const dy = old.y - p.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved.push([el, dx, dy]);
    });
    prev.current = next;
    if (!moved.length) return;
    for (const [el, dx, dy] of moved) el.style.transform = `translate(${dx}px, ${dy}px)`;
    void canvas.offsetWidth; // commit the start positions
    for (const [el] of moved) {
      el.style.transition = `transform 260ms ${EASE}`;
      el.style.transform = '';
      el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
    }
  });
}

type Target = { listId: string; index: number };

/** Where a card dropped at (x, y) would go: before the first card whose middle is below the finger. */
function targetAt(x: number, y: number, dragId: string, data: BoardData): Target | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const listEl = hit?.closest('[data-list-id]') as HTMLElement | null;
  if (!listEl) return null;
  const list = data.lists[listEl.dataset.listId!];
  if (!list) return null;
  const box = listEl.querySelector('.list-cards') as HTMLElement | null;
  if (!box) return { listId: list.id, index: list.cardIds.length };
  const yIn = y - box.getBoundingClientRect().top + box.scrollTop;
  const cards = [...box.querySelectorAll<HTMLElement>('[data-card-id]')].filter((c) => c.dataset.cardId !== dragId && c.offsetParent !== null);
  for (const c of cards) {
    // offsetTop ignores the glide animation, so the target doesn't flicker while cards move
    if (yIn < c.offsetTop + c.offsetHeight / 2) return { listId: list.id, index: list.cardIds.indexOf(c.dataset.cardId!) };
  }
  const last = cards[cards.length - 1];
  return { listId: list.id, index: last ? list.cardIds.indexOf(last.dataset.cardId!) + 1 : list.cardIds.length };
}

/** Press-and-hold to drag cards on touch screens. */
export function useTouchCardDrag({
  canvasRef,
  data,
  enabled,
  onLift,
  onTarget,
  onDrop,
  onCancel,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  data: BoardData;
  enabled: boolean;
  onLift: (cardId: string, target: Target, height: number) => void;
  onTarget: (t: Target) => void;
  onDrop: (cardId: string) => void;
  onCancel: () => void;
}) {
  const live = useRef({ data, onLift, onTarget, onDrop, onCancel });
  useLayoutEffect(() => {
    live.current = { data, onLift, onTarget, onDrop, onCancel };
  });
  const active = useRef(false);
  const suppressClick = useRef(false);

  // Once a card is lifted, the finger must move the card, not scroll the page.
  useEffect(() => {
    const stop = (e: TouchEvent) => active.current && e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, cardId: string, listId: string) => {
    if (!enabled || e.pointerType !== 'touch' || active.current) return;
    const card = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    let x = sx;
    let y = sy;
    let ghost: HTMLElement | null = null;
    let offX = 0;
    let offY = 0;
    let raf = 0;

    const cleanup = () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      active.current = false;
      setTimeout(() => (suppressClick.current = false), 400);
    };

    const lift = () => {
      const canvas = canvasRef.current;
      const list = live.current.data.lists[listId];
      if (!canvas || !list) return cleanup();
      const r = card.getBoundingClientRect();
      offX = sx - r.left;
      offY = sy - r.top;
      ghost = card.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-card-id');
      ghost.classList.add('drag-ghost');
      Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, transform: '', transition: '' });
      document.body.appendChild(ghost);
      requestAnimationFrame(() => ghost?.classList.add('lifted'));
      active.current = true;
      suppressClick.current = true;
      canvas.classList.add('touch-dragging');
      live.current.onLift(cardId, { listId, index: list.cardIds.indexOf(cardId) }, r.height);
      raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(lift, 280);

    let lastKey = '';
    const retarget = () => {
      const t = targetAt(x, y, cardId, live.current.data);
      if (!t) return;
      const key = `${t.listId}:${t.index}`;
      if (key !== lastKey) {
        lastKey = key;
        live.current.onTarget(t);
      }
    };

    // Scroll the board sideways, or the list up and down, while the finger rests near an edge.
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas || !active.current) return;
      const c = canvas.getBoundingClientRect();
      const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail')) || 0;
      const right = c.right - (document.documentElement.classList.contains('side-rail') ? rail : 0);
      const edge = 48;
      const speed = (d: number) => Math.ceil(Math.min(1, Math.max(0, (edge - d) / edge)) * 16);
      let scrolled = false;
      const dx = x > right - edge ? speed(right - x) : x < c.left + edge ? -speed(x - c.left) : 0;
      if (dx) {
        canvas.scrollLeft += dx;
        scrolled = true;
      }
      const box = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-list-id]')?.querySelector('.list-cards') as HTMLElement | null;
      if (box) {
        const b = box.getBoundingClientRect();
        const dy = y > b.bottom - edge && y < b.bottom + 20 ? speed(b.bottom - y) : y < b.top + edge && y > b.top - 20 ? -speed(y - b.top) : 0;
        if (dy) {
          box.scrollTop += dy;
          scrolled = true;
        }
      }
      if (scrolled) retarget();
      raf = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!active.current) {
        // moved before the press was long enough: it's a scroll, not a drag
        if (Math.hypot(x - sx, y - sy) > 8) cleanup();
        return;
      }
      if (ghost) {
        ghost.style.left = `${x - offX}px`;
        ghost.style.top = `${y - offY}px`;
      }
      retarget();
    };

    const up = () => {
      if (!active.current || !ghost) return cleanup();
      const g = ghost;
      const canvas = canvasRef.current;
      canvas?.classList.remove('touch-dragging');
      // settle into the gap, then hand over to the real card
      const slot = canvas?.querySelector('.card-placeholder') as HTMLElement | null;
      const s = slot?.getBoundingClientRect();
      g.classList.remove('lifted');
      g.classList.add('dropping');
      if (s) Object.assign(g.style, { left: `${s.left}px`, top: `${s.top}px` });
      cleanup();
      setTimeout(
        () => {
          live.current.onDrop(cardId);
          requestAnimationFrame(() => g.remove());
        },
        s && !reduced() ? 190 : 0,
      );
    };

    const cancel = () => {
      const was = active.current;
      ghost?.remove();
      canvasRef.current?.classList.remove('touch-dragging');
      cleanup();
      if (was) live.current.onCancel();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  /** Swallow the tap that iOS sends after a press-and-hold drag, so the card doesn't open. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return { onPointerDown, onClickCapture };
}
