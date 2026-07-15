"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SETTINGS,
  MAX_RECENT_PEOPLE,
  normalizeSettings
} = require("../shared/config.js");

test("privacy-sensitive features default off", () => {
  assert.equal(DEFAULT_SETTINGS.enabled, false);
  assert.equal(DEFAULT_SETTINGS.rememberRecentPeople, false);
  assert.equal(DEFAULT_SETTINGS.breakMinutes, 0);
  assert.equal(MAX_RECENT_PEOPLE, 15);
});

test("normalizeSettings rejects invalid stored values", () => {
  const normalized = normalizeSettings({
    enabled: "yes",
    duration: -1,
    breakMinutes: 999,
    workdayStart: "99:00",
    workdayEnd: "01:00",
    outputTimezone: "Not/AZone",
    rememberRecentPeople: "yes"
  });

  assert.equal(normalized.enabled, DEFAULT_SETTINGS.enabled);
  assert.equal(normalized.duration, DEFAULT_SETTINGS.duration);
  assert.equal(normalized.breakMinutes, DEFAULT_SETTINGS.breakMinutes);
  assert.equal(normalized.workdayStart, DEFAULT_SETTINGS.workdayStart);
  assert.equal(normalized.workdayEnd, DEFAULT_SETTINGS.workdayEnd);
  assert.equal(normalized.outputTimezone, DEFAULT_SETTINGS.outputTimezone);
  assert.equal(
    normalized.rememberRecentPeople,
    DEFAULT_SETTINGS.rememberRecentPeople
  );
});
