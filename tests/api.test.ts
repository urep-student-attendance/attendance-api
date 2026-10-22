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

const app = createApp();
let databaseAvailable = true;

async function applyMigrations() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsDir = path.join(root, "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await pool.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
  }
}

async function resetData() {
  await pool.query(`
    TRUNCATE
      student_attendance,
      time_log_mapping,
      time_log,
      registration,
      lectures,
      schedule,
      courses,
      device_room,
      rooms,
      palm_reg
    RESTART IDENTITY CASCADE
  `);
  await pool.query("UPDATE parameters SET value = 10 WHERE name = 'Time_before_lecture_start'");
  await pool.query("UPDATE parameters SET value = 20 WHERE name = 'Time_after_lecture_start'");
}

async function seedBaseFixture() {
  const room = await pool.query<{ id: string }>(
    "INSERT INTO rooms (room) VALUES ('B-101') RETURNING id",
  );
  const otherRoom = await pool.query<{ id: string }>(
    "INSERT INTO rooms (room) VALUES ('B-102') RETURNING id",
  );
  const course = await pool.query<{ id: string }>(
    "INSERT INTO courses (subject, course_num) VALUES ('INF ', '1201') RETURNING id",
  );
  const schedule = await pool.query<{ id: string }>(
    `
      INSERT INTO schedule (academic_year, semester, course_id, room_id, section)
      VALUES (2026, 1, $1, $2, 'A')
      RETURNING id
    `,
    [course.rows[0].id, room.rows[0].id],
  );
  const lecture = await pool.query<{ id: string }>(
    `
      INSERT INTO lectures (schedule_id, lecture_date, start_time, end_time)
      VALUES ($1, '2026-06-09', '09:00', '10:00')
      RETURNING id
    `,
    [schedule.rows[0].id],
  );

  await pool.query(
    "INSERT INTO palm_reg (student_id, student_palm) VALUES (60000001, 'palm-1')",
  );
  await pool.query(
    "INSERT INTO palm_reg (student_id, student_palm) VALUES (60000002, 'palm-2')",
  );
  await pool.query(
    "INSERT INTO registration (schedule_id, student_id) VALUES ($1, 60000001), ($1, 60000002)",
    [schedule.rows[0].id],
  );
  await pool.query(
    "INSERT INTO device_room (device_id, room_id) VALUES ('device-main', $1), ('device-wrong', $2)",
    [room.rows[0].id, otherRoom.rows[0].id],
  );

  return {
    lectureId: Number(lecture.rows[0].id),
    scheduleId: Number(schedule.rows[0].id),
  };
}

async function createMappedScan(scanTime: string, palm = "palm-1", device = "device-main") {
  await request(app)
    .post("/time-logs")
    .send({ device_id: device, student_palm: palm, scan_time: scanTime })
    .expect(201);
  await request(app).post("/time-log-mappings/process").send({}).expect(200);
}

try {
  await pool.query("SELECT 1");
} catch (error) {
  if (process.env.REQUIRE_DATABASE) throw error;
  databaseAvailable = false;
  console.warn("Skipping integration tests because PostgreSQL is not available.");
}

beforeAll(async () => {
  if (!databaseAvailable) return;
  await applyMigrations();
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await resetData();
});

afterAll(async () => {
  await pool.end();
});

const run = databaseAvailable ? describe : describe.skip;

run("attendance API", () => {
  it("reports health", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body.data).toBeUndefined();
    expect(response.body.status).toBe("ok");
  });

  it("lists and updates parameters, including a null late threshold", async () => {
    await request(app)
      .put("/parameters/Time_after_lecture_start")
      .send({ value: null })
      .expect(200);

    const response = await request(app).get("/parameters").expect(200);
    const late = response.body.data.find(
      (parameter: { name: string }) => parameter.name === "Time_after_lecture_start",
    );
    expect(late.value).toBeNull();
  });

  it("inserts raw scans and maps known palm/device records", async () => {
    await seedBaseFixture();

    await request(app)
      .post("/time-logs")
      .send({
        device_id: "device-main",
        student_palm: "palm-1",
        scan_time: "2026-06-09T09:00:00+03:00",
      })
      .expect(201);

    const response = await request(app)
      .post("/time-log-mappings/process")
      .send({})
      .expect(200);
    expect(response.body.data.mapped_count).toBe(1);
    expect(response.body.data.unmapped_count).toBe(0);
  });

  it.each([
    ["2026-06-09T08:50:00+03:00", "present"],
    ["2026-06-09T09:00:00+03:00", "present"],
    ["2026-06-09T09:19:00+03:00", "present"],
    ["2026-06-09T08:49:00+03:00", "absent"],
    ["2026-06-09T09:21:00+03:00", "absent"],
  ])("marks %s as %s with default thresholds", async (scanTime, status) => {
    const { lectureId } = await seedBaseFixture();
    await createMappedScan(scanTime);

    await request(app)
      .post("/attendance/process")
      .send({ lecture_id: lectureId })
      .expect(200);

    const response = await request(app)
      .get("/attendance")
      .query({ student_id: 60000001, lecture_id: lectureId })
      .expect(200);
    expect(response.body.data[0].status).toBe(status);
  });

  it("records late minutes when Time_after_lecture_start is null", async () => {
    const { lectureId } = await seedBaseFixture();
    await request(app)
      .put("/parameters/Time_after_lecture_start")
      .send({ value: null })
      .expect(200);
    await createMappedScan("2026-06-09T09:21:00+03:00");

    await request(app)
      .post("/attendance/process")
      .send({ lecture_id: lectureId })
      .expect(200);

    const response = await request(app)
      .get("/attendance")
      .query({ student_id: 60000001, lecture_id: lectureId })
      .expect(200);
    expect(response.body.data[0].status).toBe("present");
    expect(response.body.data[0].late_minutes).toBe(21);
  });

  it("creates absent attendance for registered students with no valid scan", async () => {
    const { lectureId } = await seedBaseFixture();
    await request(app)
      .post("/attendance/process")
      .send({ lecture_id: lectureId })
      .expect(200);

    const response = await request(app)
      .get("/attendance")
      .query({ student_id: 60000002, lecture_id: lectureId })
      .expect(200);
    expect(response.body.data[0].status).toBe("absent");
  });

  it("uses the earliest valid scan when multiple scans exist", async () => {
    const { lectureId } = await seedBaseFixture();
    await createMappedScan("2026-06-09T09:10:00+03:00");
    await createMappedScan("2026-06-09T08:55:00+03:00");

    await request(app)
      .post("/attendance/process")
      .send({ lecture_id: lectureId })
      .expect(200);

    const response = await request(app)
      .get("/attendance")
      .query({ student_id: 60000001, lecture_id: lectureId })
      .expect(200);
    expect(response.body.data[0].scan_time).toContain("2026-06-09T05:55:00.000Z");
  });

  it("does not count scans from the wrong room", async () => {
    const { lectureId } = await seedBaseFixture();
    await createMappedScan("2026-06-09T09:00:00+03:00", "palm-1", "device-wrong");

    await request(app)
      .post("/attendance/process")
      .send({ lecture_id: lectureId })
      .expect(200);

    const response = await request(app)
      .get("/attendance")
      .query({ student_id: 60000001, lecture_id: lectureId })
      .expect(200);
    expect(response.body.data[0].status).toBe("absent");
  });

  it("leaves unknown palm/device scans unmapped", async () => {
    await seedBaseFixture();
    await request(app)
      .post("/time-logs")
      .send({
        device_id: "device-main",
        student_palm: "unknown-palm",
        scan_time: "2026-06-09T09:00:00+03:00",
      })
      .expect(201);

    const response = await request(app)
      .post("/time-log-mappings/process")
      .send({})
      .expect(200);
    expect(response.body.data.mapped_count).toBe(0);
    expect(response.body.data.unmapped_count).toBe(1);
  });
});
