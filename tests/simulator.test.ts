import { describe, expect, it } from "vitest";
import { createCampus, lecturesBetween } from "../src/simulator/campus.js";
import { VirtualReader } from "../src/simulator/reader.js";
import { groupDeliveries } from "../src/simulator/runner.js";
import { simulateDay } from "../src/simulator/scenario.js";
import { dohaTime, dohaWeekday, toDohaIso } from "../src/simulator/time.js";

describe("simulated campus", () => {
  it("is reproducible from its seed", () => {
    expect(createCampus({ seed: "a" })).toEqual(createCampus({ seed: "a" }));
    expect(createCampus({ seed: "a" }).students).not.toEqual(createCampus({ seed: "b" }).students);
  });

  it("gives every student a clash-free timetable with unique IDs and palms", () => {
    const campus = createCampus({ students: 200 });
    expect(new Set(campus.students.map((s) => s.student_id)).size).toBe(200);
    expect(new Set(campus.students.map((s) => s.student_palm)).size).toBe(200);

    const lectures = lecturesBetween(campus, "2026-10-25", "2026-10-29");
    for (const student of campus.students) {
      const mine = lectures
        .filter((l) => student.sections.includes(l.section_key))
        .sort((a, b) => a.start - b.start);
      for (let i = 1; i < mine.length; i += 1) {
        expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end);
      }
    }
  });

  it("only schedules lectures Sunday to Thursday", () => {
    const lectures = lecturesBetween(createCampus(), "2026-10-23", "2026-10-31");
    expect(lectures.length).toBeGreaterThan(0);
    expect(lectures.every((l) => dohaWeekday(l.lecture_date) <= 4)).toBe(true);
    expect(lectures.some((l) => l.lecture_date === "2026-10-23")).toBe(false); // Friday
  });
});

describe("virtual reader", () => {
  const reader = {
    device_id: "WP500-TEST",
    model: "WavePass500",
    room: "10.2.33",
    clock_skew_seconds: 95,
  };

  it("stamps scans with its own drifting clock", () => {
    const trueTime = dohaTime("2026-10-25", "08:00");
    const event = new VirtualReader(reader).capture({
      palm: "PV-1",
      trueTime,
      intent: "on_time",
      studentId: 1,
      sectionKey: "X",
    })!;
    expect(event.scan.scan_time).toBe("2026-10-25T08:01:35+03:00");
    expect(event.buffered).toBe(false);
  });

  it("buffers scans while offline and delivers them when the network returns", () => {
    const virtual = new VirtualReader(reader);
    const from = dohaTime("2026-10-25", "08:00");
    const to = dohaTime("2026-10-25", "09:00");
    virtual.goOffline(from, to);
    const event = virtual.capture({
      palm: "PV-1",
      trueTime: from + 60_000,
      intent: "on_time",
      studentId: 1,
      sectionKey: "X",
    })!;
    expect(event.buffered).toBe(true);
    expect(event.deliver_at).toBeGreaterThan(to);
  });

  it("rejects palms that were never enrolled on the device", () => {
    const event = new VirtualReader(reader).capture({
      palm: null,
      trueTime: Date.now(),
      intent: "on_time",
      studentId: 1,
      sectionKey: "X",
    });
    expect(event).toBeNull();
  });
});

describe("simulated day", () => {
  it("is reproducible and covers the messy cases", () => {
    const campus = createCampus();
    const days = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"].map((date) =>
      simulateDay(campus, date),
    );
    expect(simulateDay(campus, "2026-10-25")).toEqual(days[0]);

    const intents = new Set(days.flatMap((d) => d.events.map((e) => e.intent)));
    for (const intent of ["on_time", "late", "duplicate", "visitor", "walk_by"]) {
      expect(intents).toContain(intent);
    }
    expect(days.some((d) => d.outages.length > 0)).toBe(true);
    expect(days.flatMap((d) => d.events).some((e) => e.buffered)).toBe(true);

    const causes = new Set(days.flatMap((d) => d.expected.map((e) => e.cause)));
    expect(causes).toContain("counted");
    expect(causes).toContain("skipped_class");
    expect(causes).toContain("palm_not_linked");
  });

  it("sends readers' timestamps in Doha time", () => {
    const day = simulateDay(createCampus(), "2026-10-25");
    expect(day.events.every((e) => e.scan.scan_time.endsWith("+03:00"))).toBe(true);
    expect(day.events.every((e) => e.scan.scan_time.startsWith("2026-10-25"))).toBe(true);
    expect(toDohaIso(dohaTime("2026-10-25", "08:00"))).toBe("2026-10-25T08:00:00+03:00");
  });

  it("groups each reader's offline flush into one batch", () => {
    const campus = createCampus();
    const day = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]
      .map((date) => simulateDay(campus, date))
      .find((d) => d.events.some((e) => e.buffered))!;
    const deliveries = groupDeliveries(day.events);
    const flushes = deliveries.filter((d) => d.buffered);
    expect(flushes).toHaveLength(1);
    expect(flushes[0].events.length).toBe(day.events.filter((e) => e.buffered).length);
    expect(deliveries.reduce((n, d) => n + d.events.length, 0)).toBe(day.events.length);
  });
});
