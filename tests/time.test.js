"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { zonedDateTimeToDate } = require("../core/time.js");

test("Denver workday conversion follows daylight saving time", () => {
  assert.equal(
    zonedDateTimeToDate("2026-07-10", 9, 0, "America/Denver").toISOString(),
    "2026-07-10T15:00:00.000Z"
  );

  assert.equal(
    zonedDateTimeToDate("2026-01-10", 9, 0, "America/Denver").toISOString(),
    "2026-01-10T16:00:00.000Z"
  );
});

test("Phoenix remains on UTC-7 in summer and winter", () => {
  assert.equal(
    zonedDateTimeToDate("2026-07-10", 9, 0, "America/Phoenix").toISOString(),
    "2026-07-10T16:00:00.000Z"
  );

  assert.equal(
    zonedDateTimeToDate("2026-01-10", 9, 0, "America/Phoenix").toISOString(),
    "2026-01-10T16:00:00.000Z"
  );
});
