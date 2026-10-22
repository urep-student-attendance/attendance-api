import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://attendance:attendance@localhost:5433/attendance_test";

const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db.js");
const { createCampus } = await import("../src/simulator/campus.js");
const { simulateDay } = await import("../src/simulator/scenario.js");
const { seedCampus } = await import("../src/simulator/seed.js");
const { compareAttendance, deliverDay } = await import("../src/simulator/runner.js");
const { catchUp } = await import("../src/simulator/catchUp.js");
const { dohaTime } = await import("../src/simulator/time.js");
type Transport = import("../src/simulator/runner.js").Transport;

const app = createApp();
let databaseAvailable = true;

try {
  await pool.query("SELECT 1");
} catch (error) {
  if (process.env.REQUIRE_DATABASE) throw error;
  databaseAvailable = false;
  console.warn("Skipping simulator integration tests because PostgreSQL is not available.");
}

const transport: Transport = {
  sendScan: async (scan) => void (await request(app).post("/time-logs").send(scan).expect(201)),
  sendBatch: async (scans) =>
    void (await request(app).post("/time-logs/batch").send({ scans }).expect(201)),
  processMappings: async () =>
    (await request(app).post("/time-log-mappings/process").send({}).expect(200)).body.data,
  processAttendance: async (range) =>
    (await request(app).post("/attendance/process").send(range).expect(200)).body.data,
  listAttendance: async () => (await request(app).get("/attendance").expect(200)).body.data,
};

beforeAll(async () => {
  if (!databaseAvailable) return;
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  for (const file of (await fs.readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
  }
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await pool.query(`
    TRUNCATE student_attendance, time_log_mapping, time_log, registration, lectures,
      schedule, courses, device_room, rooms, palm_reg, students
    RESTART IDENTITY CASCADE
  `);
  await pool.query("UPDATE parameters SET value = 10 WHERE name = 'Time_before_lecture_start'");
  await pool.query("UPDATE parameters SET value = 20 WHERE name = 'Time_after_lecture_start'");
});

afterAll(async () => {
  await pool.end();
});

const run = databaseAvailable ? describe : describe.skip;
const WEEK = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];

run("simulated readers against the API", () => {
  it("accepts a batch flush from an offline reader", async () => {
    const response = await request(app)
      .post("/time-logs/batch")
      .send({
        scans: [
          { device_id: "WP500-X", student_palm: "PV-1", scan_time: "2026-10-25T08:01:00+03:00" },
          { device_id: "WP500-X", student_palm: "PV-2", scan_time: "2026-10-25T08:02:00+03:00" },
        ],
      })
      .expect(201);
    expect(response.body.data.inserted_count).toBe(2);
    const rows = await pool.query("SELECT count(*)::int AS n FROM time_log");
    expect(rows.rows[0].n).toBe(2);
  });

  it("rejects an empty batch", async () => {
    await request(app).post("/time-logs/batch").send({ scans: [] }).expect(400);
  });

  it("produces exactly the attendance the simulation expects for a full week", async () => {
    const campus = createCampus();
    const { lectureIds } = await seedCampus(pool, campus, WEEK[0], WEEK[WEEK.length - 1]);

    let expectedRows = 0;
    for (const date of WEEK) {
      const day = simulateDay(campus, date, { parameters: { before: 10, after: 20 } });
      await deliverDay(day, transport);
      const mismatches = compareAttendance(day.expected, await transport.listAttendance(), lectureIds);
      expect(mismatches).toEqual([]);
      expectedRows += day.expected.length;
    }

    const counts = await pool.query("SELECT count(*)::int AS n FROM student_attendance");
    expect(counts.rows[0].n).toBe(expectedRows);
    const unmapped = await pool.query("SELECT count(*)::int AS n FROM time_log WHERE NOT transferred");
    expect(unmapped.rows[0].n).toBeGreaterThan(0); // visitors, corridor reader, unlinked palms
  });

  it("records late minutes when the late cutoff is turned off", async () => {
    await request(app).put("/parameters/Time_after_lecture_start").send({ value: null }).expect(200);
    const campus = createCampus({ seed: "late-cutoff-off" });
    const { lectureIds } = await seedCampus(pool, campus, WEEK[0], WEEK[0]);
    const day = simulateDay(campus, WEEK[0], { parameters: { before: 10, after: null } });
    await deliverDay(day, transport);

    expect(compareAttendance(day.expected, await transport.listAttendance(), lectureIds)).toEqual([]);
    expect(day.expected.some((e) => (e.late_minutes ?? 0) > 20)).toBe(true);
  });

  it("is safe to seed twice", async () => {
    const campus = createCampus();
    const first = await seedCampus(pool, campus, WEEK[0], WEEK[1]);
    const second = await seedCampus(pool, campus, WEEK[0], WEEK[1]);
    expect([...second.lectureIds]).toEqual([...first.lectureIds]);
  });

  it("serves one student's tables to the app", async () => {
    const campus = createCampus();
    const { lectureIds } = await seedCampus(pool, campus, WEEK[0], WEEK[1]);
    for (const date of WEEK.slice(0, 2)) await deliverDay(simulateDay(campus, date), transport);

    const student = campus.students.find((s) => s.palm_status === "linked")!;
    const { body } = await request(app).get(`/students/${student.student_id}/overview`).expect(200);
    const data = body.data;

    expect(data.student).toMatchObject({ student_id: student.student_id, name: student.name });
    expect(data.palm_reg.map((p: { student_palm: string }) => p.student_palm)).toEqual([student.student_palm]);
    expect(data.sections).toHaveLength(student.sections.length);
    expect(data.sections.every((s: { instructor: string }) => s.instructor)).toBe(true);
    expect(data.courses.every((c: { title: string }) => c.title)).toBe(true);
    expect(data.lectures[0]).toMatchObject({ lecture_date: expect.stringMatching(/^2026-10-2\d$/), start_time: expect.stringMatching(/^\d\d:\d\d$/) });
    expect(data.parameters).toEqual({ Time_before_lecture_start: 10, Time_after_lecture_start: 20 });
    expect(data.time_logs.every((t: { student_palm: string }) => t.student_palm === student.student_palm)).toBe(true);

    const mine = [...lectureIds].filter(([key]) => student.sections.includes(key.split("|")[0]));
    expect(data.lectures).toHaveLength(mine.length);
    expect(data.attendance).toHaveLength(mine.length);
  });

  it("serves a student whose palm was never linked, without scans", async () => {
    const campus = createCampus();
    await seedCampus(pool, campus, WEEK[0], WEEK[0]);
    await deliverDay(simulateDay(campus, WEEK[0]), transport);
    const student = campus.students.find((s) => s.palm_status !== "linked")!;
    const { body } = await request(app).get(`/students/${student.student_id}/overview`).expect(200);
    expect(body.data.palm_reg).toEqual([]);
    expect(body.data.time_logs).toEqual([]);
    expect(body.data.sections.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown student and 400 for a bad ID", async () => {
    await request(app).get("/students/60999999/overview").expect(404);
    await request(app).get("/students/abc/overview").expect(400);
  });

  it("catches up in steps without sending a scan twice", async () => {
    const campus = createCampus();
    const parameters = { before: 10, after: 20 };
    const run = (until: string) =>
      catchUp({ campus, pool, transport, parameters, from: WEEK[0], until: dohaTime(WEEK[1], until) });

    const morning = await run("10:00");
    expect(morning.map((d) => d.date)).toEqual([WEEK[0], WEEK[1]]);
    expect(morning[0].mismatches).toBe(0); // yesterday is complete
    expect(morning[1].pending).toBeGreaterThan(0); // today is not
    const afterMorning = (await pool.query("SELECT count(*)::int AS n FROM time_log")).rows[0].n;

    const again = await run("10:00");
    expect(again.every((d) => d.sent === 0)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM time_log")).rows[0].n).toBe(afterMorning);

    const night = await run("23:59");
    expect(night[1]).toMatchObject({ pending: 0, mismatches: 0 });
    expect(night[1].sent).toBeGreaterThan(0);
    const total = (await pool.query("SELECT count(*)::int AS n FROM time_log")).rows[0].n;
    const expected = [WEEK[0], WEEK[1]].reduce((n, date) => n + simulateDay(campus, date).events.length, 0);
    expect(total).toBe(expected);
  });
});
