/**
 * When the header tucks away and when it returns. Kept apart from the
 * component so the rule can be tested without a browser.
 *
 * The header used to follow the direction of every single scroll event. A
 * smooth-scroll tail, a trackpad or a finger gives changes of a pixel either
 * way, so it flipped between hidden and shown many times a second. Here a
 * change of direction only counts once the page has travelled a real distance
 * that way.
 */

/** Above this the header always shows: the first screen never loses its menu. */
export const ALWAYS_SHOWN_ABOVE = 480;
/** Distance scrolled down, since last turning round, before the header tucks away. */
export const HIDE_AFTER = 72;
/** Distance scrolled back up before it returns. Shorter: reaching for the menu should feel immediate. */
export const SHOW_AFTER = 28;
/** The header gains its solid ground once the page has moved this far. */
export const SOLID_AFTER = 24;

export type HeaderScroll = {
  /** Last position seen. */
  y: number;
  /** 1 scrolling down, -1 up, 0 before any movement. */
  direction: -1 | 0 | 1;
  /** Position where the current direction began. */
  anchor: number;
  hidden: boolean;
};

export const initialHeaderScroll = (y = 0): HeaderScroll => ({ y, direction: 0, anchor: y, hidden: false });

/**
 * The state after the page has moved to `rawY`. `maxY` is the furthest the
 * page can scroll: positions beyond either end (the rubber band on a phone)
 * are treated as the end itself, so a bounce is not read as scrolling back.
 */
export function nextHeaderScroll(state: HeaderScroll, rawY: number, maxY: number): HeaderScroll {
  const y = Math.min(Math.max(rawY, 0), Math.max(maxY, 0));
  if (y <= ALWAYS_SHOWN_ABOVE) return { y, direction: 0, anchor: y, hidden: false };
  if (y === state.y) return state;

  const direction = y > state.y ? 1 : -1;
  const anchor = direction === state.direction ? state.anchor : state.y;
  const travelled = y - anchor;
  const hidden = travelled >= HIDE_AFTER ? true : travelled <= -SHOW_AFTER ? false : state.hidden;
  return { y, direction, anchor, hidden };
}
