import assert from "node:assert/strict";
import test from "node:test";
import { directionLabel, inferDirectionName, routeStationsForDirection } from "../src/lib/directions";

const lineTwoStations = ["시청", "을지로입구", "을지로3가", "신당", "충정로"].map((stationName, index) => ({
  stationName,
  sequenceNo: index + 1
}));

test("infers the shortest circular direction for Seoul line 2", () => {
  assert.equal(inferDirectionName("2", lineTwoStations, "충정로", "시청"), "내선");
  assert.equal(inferDirectionName("2", lineTwoStations, "시청", "충정로"), "외선");
});

test("builds line 2 circular routes across the sequence boundary", () => {
  assert.deepEqual(
    routeStationsForDirection("2", lineTwoStations, "내선", "충정로", "을지로입구").map(
      (station) => station.stationName
    ),
    ["충정로", "시청", "을지로입구"]
  );
  assert.deepEqual(
    routeStationsForDirection("2", lineTwoStations, "외선", "시청", "충정로").map((station) => station.stationName),
    ["시청", "충정로"]
  );
});

test("keeps terminal-bound labels for non-circular lines", () => {
  const lineThreeStations = ["대화", "경복궁", "오금"].map((stationName, index) => ({
    stationName,
    sequenceNo: index + 1
  }));

  assert.equal(inferDirectionName("3", lineThreeStations, "대화", "오금"), "오금");
  assert.equal(inferDirectionName("3", lineThreeStations, "오금", "경복궁"), "대화");
  assert.equal(directionLabel("3", "오금"), "오금 방면");
  assert.equal(directionLabel("2", "내선"), "내선순환");
});
