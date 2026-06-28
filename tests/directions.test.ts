import assert from "node:assert/strict";
import test from "node:test";
import transitLines from "../public/transit-lines.json";
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

test("infers practical inner and outer directions on Seoul line 2 main loop data", () => {
  const lineTwo = transitLines.lines.find((line) => line.line_no === "2");
  assert.ok(lineTwo);
  assert.equal(lineTwo.stations.length, 43);
  assert.ok(!lineTwo.stations.some((station) => /^32/.test(station.station_code)));
  assert.ok(!lineTwo.stations.some((station) => ["까치산", "도림천", "양천구청", "신정네거리"].includes(station.station_name)));
  const directionStations = lineTwo.stations.map((station) => ({
    stationName: station.station_name,
    sequenceNo: station.sequence_no
  }));

  assert.equal(inferDirectionName("2", directionStations, "신도림", "선릉"), "외선");
  assert.equal(inferDirectionName("2", directionStations, "선릉", "신도림"), "내선");
  assert.deepEqual(
    routeStationsForDirection("2", directionStations, "외선", "신도림", "선릉").map((station) => station.stationName),
    ["신도림", "대림", "구로디지털단지", "신대방", "신림", "봉천", "서울대입구", "낙성대", "사당", "방배", "서초", "교대", "강남", "역삼", "선릉"]
  );
});

test("keeps Incheon line 2 separate from Seoul line 2", () => {
  const incheonTwo = transitLines.lines.find((line) => line.line_no === "인천2");
  assert.ok(incheonTwo);
  assert.equal(incheonTwo.label, "인천 2호선");
  assert.deepEqual(
    incheonTwo.stations.map((station) => station.station_name).slice(0, 3),
    ["검단오류", "왕길", "검단사거리"]
  );
});
