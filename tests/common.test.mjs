import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Meetza = require("../src/common.js");

/*
 * Security tests
 * These tests cover pure security-related behavior exported by common.js.
 */

test("privacy-sensitive features default off", () => {
  assert.equal(Meetza.DEFAULTS.enabled, false);
  assert.equal(Meetza.DEFAULTS.rememberRecentPeople, false);
  assert.equal(Meetza.DEFAULTS.breakMinutes, 0);
});

test("invalid stored settings fail closed", () => {
  const settings = Meetza.normalizeSettings({
    enabled: "yes",
    duration: -1,
    breakMinutes: 999,
    workdayStart: "20:00",
    workdayEnd: "08:00",
    outputTimezone: "Mars/Base",
    rememberRecentPeople: "yes"
  });

  assert.deepEqual(settings, Meetza.DEFAULTS);
});

test("date validation rejects malformed and impossible dates", () => {
  assert.equal(Meetza.isDate("2026-07-15"), true);

  assert.equal(Meetza.isDate("2026-02-29"), false);
  assert.equal(Meetza.isDate("2026-13-01"), false);
  assert.equal(Meetza.isDate("2026-00-01"), false);
  assert.equal(Meetza.isDate("not-a-date"), false);
  assert.equal(Meetza.isDate(null), false);
});

test("time zones must come from the supported allowlist", () => {
  assert.equal(
    Meetza.timezoneOption("America/Denver")?.zone,
    "America/Denver"
  );

  assert.equal(Meetza.timezoneOption("UTC")?.zone, "UTC");
  assert.equal(Meetza.timezoneOption("Mars/Base"), null);
  assert.equal(Meetza.timezoneOption(""), null);
});

/*
 * Product tests
 *
 * These protect the set of calculations Meetza depends on.
 */

test("add day skips weekends", () => {
  assert.equal(
    Meetza.nextBusinessDate(["2026-07-17"]),
    "2026-07-20"
  );

  assert.equal(
    Meetza.nextBusinessDate(["2026-07-16"]),
    "2026-07-17"
  );
});

test("busy ranges merge and break padding is applied", () => {
  const start = new Date("2026-07-15T15:00:00Z");
  const end = new Date("2026-07-15T23:00:00Z");

  const busy = [
    {
      start: Date.parse("2026-07-15T18:00:00Z"),
      end: Date.parse("2026-07-15T19:00:00Z")
    },
    {
      start: Date.parse("2026-07-15T18:30:00Z"),
      end: Date.parse("2026-07-15T20:00:00Z")
    }
  ];

  const free = Meetza.freeRanges({
    busy,
    start,
    end,
    duration: 60,
    breakMinutes: 15
  });

  assert.deepEqual(free, [
    {
      start: Date.parse("2026-07-15T15:00:00Z"),
      end: Date.parse("2026-07-15T17:45:00Z")
    },
    {
      start: Date.parse("2026-07-15T20:15:00Z"),
      end: Date.parse("2026-07-15T23:00:00Z")
    }
  ]);
});

test("free ranges shorter than the meeting length are removed", () => {
  const free = Meetza.freeRanges({
    start: new Date("2026-07-15T15:00:00Z"),
    end: new Date("2026-07-15T18:00:00Z"),
    duration: 90,
    busy: [
      {
        start: Date.parse("2026-07-15T16:00:00Z"),
        end: Date.parse("2026-07-15T17:00:00Z")
      }
    ]
  });

  assert.deepEqual(free, []);
});

test("timezone conversion handles daylight saving and Arizona", () => {
  assert.equal(
    Meetza.zonedDateTime(
      "2026-07-15",
      "09:00",
      "America/Denver"
    ).toISOString(),
    "2026-07-15T15:00:00.000Z"
  );

  assert.equal(
    Meetza.zonedDateTime(
      "2026-01-15",
      "09:00",
      "America/Denver"
    ).toISOString(),
    "2026-01-15T16:00:00.000Z"
  );

  assert.equal(
    Meetza.zonedDateTime(
      "2026-07-15",
      "09:00",
      "America/Phoenix"
    ).toISOString(),
    "2026-07-15T16:00:00.000Z"
  );

  assert.equal(
    Meetza.zonedDateTime(
      "2026-01-15",
      "09:00",
      "America/Phoenix"
    ).toISOString(),
    "2026-01-15T16:00:00.000Z"
  );
});

