import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlacement } from "../src/content/placement.ts";

const overlaps = (a: { top: number; bottom: number }, top: number, h: number) => top < a.bottom && top + h > a.top;

test("goes below the chat box when it fits", () => {
  const box = { top: 340, bottom: 418, left: 140, right: 1290 };
  const p = computePlacement(box, 1400, 823, 300);
  assert.equal(p.top, 428);
  assert.ok(!overlaps(box, p.top, Math.min(300, p.maxHeight)));
});

test("goes above when the chat box is at the bottom of the screen", () => {
  const box = { top: 700, bottom: 780, left: 100, right: 900 };
  const p = computePlacement(box, 1000, 800, 300);
  assert.equal(p.top, 390);
  assert.ok(!overlaps(box, p.top, 300));
});

test("never covers the chat box when it fits on neither side: it scrolls instead", () => {
  // The case from the ChatGPT screenshot: chat box mid-screen, popup taller than either gap.
  const box = { top: 340, bottom: 418, left: 140, right: 1290 };
  const p = computePlacement(box, 1400, 823, 430);
  assert.equal(p.top, 428);
  assert.equal(p.maxHeight, 383);
  assert.ok(!overlaps(box, p.top, Math.min(430, p.maxHeight)));
});

test("stays inside the screen horizontally", () => {
  const p = computePlacement({ top: 100, bottom: 150, left: 0, right: 200 }, 360, 800, 200);
  assert.ok(p.left >= 12 && p.left + p.width <= 348);
});
