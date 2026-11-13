import { describe, expect, it } from "vitest";
import { HIDE_AFTER, SHOW_AFTER, initialHeaderScroll, nextHeaderScroll, type HeaderScroll } from "@/components/layout/headerScroll";

const MAX = 10_000;

/** Runs the positions in order and returns each state, so a test can count changes. */
function run(positions: number[], start = initialHeaderScroll(), max = MAX): HeaderScroll[] {
  const states: HeaderScroll[] = [];
  let state = start;
  for (const y of positions) {
    state = nextHeaderScroll(state, y, max);
    states.push(state);
  }
  return states;
}

const changes = (states: HeaderScroll[], from = false) => states.reduce((count, state, index) => count + (state.hidden !== (index ? states[index - 1].hidden : from) ? 1 : 0), 0);

const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor(Math.abs(to - from) / Math.abs(step)) + 1 }, (_, index) => from + index * step);

describe("header scroll rule", () => {
  it("stays shown on the first screen", () => {
    expect(run(range(0, 480, 20)).every((state) => !state.hidden)).toBe(true);
  });

  it("tucks away once after scrolling down a real distance", () => {
    const states = run(range(0, 2000, 25));
    expect(states.at(-1)?.hidden).toBe(true);
    expect(changes(states)).toBe(1);
  });

  it("returns once after scrolling back up, and not for a pixel", () => {
    const down = run(range(0, 2000, 25)).at(-1)!;
    expect(nextHeaderScroll(down, 1999, MAX).hidden).toBe(true);
    const up = run(range(2000, 2000 - SHOW_AFTER - 10, -2), down);
    expect(up.at(-1)?.hidden).toBe(false);
    expect(changes(up, true)).toBe(1);
  });

  it("does not flicker when the position trembles by a pixel either way", () => {
    // What was measured in the browser: a smooth-scroll tail that repeats a
    // position and then moves one pixel. The old rule showed and hid the
    // header within 15 ms here.
    const down = run(range(0, 990, 30)).at(-1)!;
    const tail = run([990, 990, 991, 991, 990, 991, 992, 991, 992, 992, 991], down);
    expect(changes(tail, down.hidden)).toBe(0);

    const shown = run(range(2000, 1900, -5), run(range(0, 2000, 25)).at(-1)!).at(-1)!;
    expect(shown.hidden).toBe(false);
    const tremble = run([1899, 1900, 1901, 1900, 1899, 1898, 1899, 1900, 1901, 1902, 1901], shown);
    expect(changes(tremble, false)).toBe(0);
  });

  it("needs the full distance in one direction: small reversals start the count again", () => {
    const shown = run(range(2000, 1900, -5), run(range(0, 2000, 25)).at(-1)!).at(-1)!;
    const half = Math.floor(HIDE_AFTER / 2);
    const states = run([1900 + half, 1900 + half - 2, 1900 + half - 2 + half], shown);
    expect(states.at(-1)?.hidden).toBe(false);
  });

  it("treats a bounce past the end of the page as the end", () => {
    const max = 3000;
    const bottom = run(range(0, max, 25), initialHeaderScroll(), max).at(-1)!;
    expect(bottom.hidden).toBe(true);
    const bounce = run([3040, 3080, 3040, 3000, 3000], bottom, max);
    expect(changes(bounce, true)).toBe(0);
  });

  it("shows again at the top, however the page got there", () => {
    const down = run(range(0, 2000, 25)).at(-1)!;
    expect(nextHeaderScroll(down, 0, MAX).hidden).toBe(false);
    expect(nextHeaderScroll(down, -60, MAX).hidden).toBe(false);
  });
});
