import assert from "node:assert/strict";
import test from "node:test";
import { parseDayType, parseTimeSlot } from "../src/lib/api";

test("parses explicit recommendation day type and time slot inputs", () => {
  assert.equal(parseDayType("WEEKDAY"), "WEEKDAY");
  assert.equal(parseDayType("WEEKEND"), "WEEKEND");
  assert.equal(parseTimeSlot("08:00"), "08:00");
  assert.equal(parseTimeSlot("23:30"), "23:30");
});

test("rejects unsupported recommendation day type and time slot inputs", () => {
  assert.throws(() => parseDayType("HOLIDAY"), /WEEKDAY 또는 WEEKEND/);
  assert.throws(() => parseDayType(null), /WEEKDAY 또는 WEEKEND/);
  assert.throws(() => parseTimeSlot("08:15"), /HH:00 또는 HH:30/);
  assert.throws(() => parseTimeSlot("24:00"), /HH:00 또는 HH:30/);
});
