"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findFreeRanges, mergeRanges } = require("../core/availability.js");

const MINUTE = 60_000;
const DAY_START = Date.UTC(2026, 6, 1, 9, 0);
const DAY_END = Date.UTC(2026, 6, 1, 17, 0);

function date(value) {
  return new Date(value);
}

test("mergeRanges combines overlapping and touching ranges", () => {
  assert.deepEqual(
    mergeRanges([
      { start: 30, end: 40 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
      { start: 35, end: 50 }
    ]),
    [
      { start: 10, end: 25 },
      { start: 30, end: 50 }
    ]
  );
});

test("findFreeRanges preserves partial-hour boundaries", () => {
  const slots = findFreeRanges({
    busyRanges: [
      {
        start: DAY_START + 3.5 * 60 * MINUTE,
        end: DAY_START + 4.5 * 60 * MINUTE
      }
    ],
    windowStart: date(DAY_START),
    windowEnd: date(DAY_END),
    minimumMinutes: 60,
    breakMinutes: 0
  });

  assert.deepEqual(slots, [
    {
      start: DAY_START,
      end: DAY_START + 3.5 * 60 * MINUTE
    },
    {
      start: DAY_START + 4.5 * 60 * MINUTE,
      end: DAY_END
    }
  ]);
});

test("break padding is applied before and after busy ranges", () => {
  const slots = findFreeRanges({
    busyRanges: [
      {
        start: DAY_START + 3 * 60 * MINUTE,
        end: DAY_START + 4 * 60 * MINUTE
      }
    ],
    windowStart: date(DAY_START),
    windowEnd: date(DAY_END),
    minimumMinutes: 60,
    breakMinutes: 15
  });

  assert.deepEqual(slots, [
    {
      start: DAY_START,
      end: DAY_START + 2.75 * 60 * MINUTE
    },
    {
      start: DAY_START + 4.25 * 60 * MINUTE,
      end: DAY_END
    }
  ]);
});

test("ranges shorter than the meeting length are omitted", () => {
  const slots = findFreeRanges({
    busyRanges: [
      {
        start: DAY_START + 30 * MINUTE,
        end: DAY_END
      }
    ],
    windowStart: date(DAY_START),
    windowEnd: date(DAY_END),
    minimumMinutes: 60,
    breakMinutes: 0
  });

  assert.deepEqual(slots, []);
});
