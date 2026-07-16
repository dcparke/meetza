import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Meetza = require("../src/common.js");

test("security-sensitive settings default off", () => {
  assert.equal(Meetza.DEFAULTS.enabled, false);
  assert.equal(Meetza.DEFAULTS.rememberRecentPeople, false);
  assert.equal(Meetza.DEFAULTS.breakMinutes, 0);
});

test("Add Day skips weekends", () => {
  assert.equal(Meetza.nextBusinessDate(["2026-07-17"]), "2026-07-20");
  assert.equal(Meetza.nextBusinessDate(["2026-07-16"]), "2026-07-17");
});

test("break padding shortens free ranges", () => {
  const start = new Date("2026-07-15T15:00:00Z");
  const end = new Date("2026-07-15T23:00:00Z");
  const busy = [{
    start: Date.parse("2026-07-15T18:00:00Z"),
    end: Date.parse("2026-07-15T19:00:00Z")
  }];

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
      start: Date.parse("2026-07-15T19:15:00Z"),
      end: Date.parse("2026-07-15T23:00:00Z")
    }
  ]);
});

test("timezone conversion respects daylight saving", () => {
  assert.equal(
    Meetza.zonedDateTime("2026-07-15", "09:00", "America/Denver").toISOString(),
    "2026-07-15T15:00:00.000Z"
  );
  assert.equal(
    Meetza.zonedDateTime("2026-01-15", "09:00", "America/Denver").toISOString(),
    "2026-01-15T16:00:00.000Z"
  );
  assert.equal(
    Meetza.zonedDateTime("2026-07-15", "09:00", "America/Phoenix").toISOString(),
    "2026-07-15T16:00:00.000Z"
  );
});

test("invalid stored settings fall back safely", () => {
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
