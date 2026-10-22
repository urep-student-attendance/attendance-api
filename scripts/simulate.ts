// Palm reader simulator CLI. Stands in for the WavePass500 readers until the real devices
// can post to the API.
//
//   npm run sim -- campus                          print the simulated campus (students, palms, readers)
//   npm run sim -- seed --from 2026-10-25 --to 2026-11-05
//   npm run sim -- day --date 2026-10-25 [--speed 60] [--live] [--dry-run]
//   npm run sim -- scan --device WP500-Q24A0101 --palm PV-1234ABCD [--at 2026-10-25T08:02:00+03:00]
//   npm run sim -- catch-up [--from 2026-08-30] [--until 2026-10-25T12:00:00+03:00] [--verify]
//                                                  send every scan due by now that the API lacks
//                                                  (default: yesterday and today); run it on a timer
import { parseArgs } from "node:util";
import { createCampus } from "../src/simulator/campus.js";
import { compareAttendance, deliverDay, httpTransport, summarize } from "../src/simulator/runner.js";
import { simulateDay } from "../src/simulator/scenario.js";
import { addDays, todayInDoha, toDohaIso } from "../src/simulator/time.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    api: { type: "string", default: process.env.SIM_API_URL ?? "http://localhost:3000" },
    seed: { type: "string", default: "urep-32" },
    students: { type: "string", default: "90" },
    date: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    speed: { type: "string", default: "0" },
    live: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "no-outages": { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    device: { type: "string" },
    palm: { type: "string" },
    at: { type: "string" },
    until: { type: "string" },
  },
});

const command = positionals[0] ?? "help";
const campus = createCampus({ seed: values.seed, students: Number(values.students) });
const api = httpTransport(values.api!);

async function withPool<T>(fn: (pool: typeof import("../src/db.js").pool) => Promise<T>) {
  const { pool } = await import("../src/db.js");
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function readParameters() {
  const response = await fetch(new URL("/parameters", values.api));
  if (!response.ok) throw new Error(`GET /parameters failed with ${response.status}`);
  const { data } = (await response.json()) as { data: { name: string; value: number | null }[] };
  const value = (name: string) => data.find((p) => p.name === name)?.value ?? null;
  return { before: value("Time_before_lecture_start") ?? 10, after: value("Time_after_lecture_start") };
}

async function main() {
  switch (command) {
    case "campus": {
      console.log(JSON.stringify(campus, null, 2));
      return;
    }

    case "seed": {
      const from = values.from ?? todayInDoha();
      const to = values.to ?? from;
      const { seedCampus } = await import("../src/simulator/seed.js");
      const result = await withPool((pool) => seedCampus(pool, campus, from, to));
      console.log(
        `Seeded ${campus.students.length} students, ${campus.sections.length} sections, ` +
          `${campus.readers.filter((r) => r.room).length} readers and ${result.lectureIds.size} lectures (${from} to ${to}).`,
      );
      return;
    }

    case "day": {
      const date = values.date ?? todayInDoha();
      const parameters = values["dry-run"] ? { before: 10, after: 20 } : await readParameters();
      const day = simulateDay(campus, date, { parameters, outages: !values["no-outages"] });
      console.log(JSON.stringify(summarize(day), null, 2));
      if (values["dry-run"]) return;

      const { seedCampus } = await import("../src/simulator/seed.js");
      const { lectureIds } = await withPool((pool) => seedCampus(pool, campus, date, date));
      const result = await deliverDay(day, api, {
        speed: Number(values.speed),
        processContinuously: values.live,
        onDelivery: (d) => {
          if (Number(values.speed) > 0 || d.buffered) {
            const first = d.events[0];
            console.log(
              `${toDohaIso(d.deliver_at).slice(11, 19)} ${first.scan.device_id} ` +
                (d.buffered ? `flushed ${d.events.length} buffered scans` : `${first.scan.student_palm} (${first.intent})`),
            );
          }
        },
      });
      console.log(JSON.stringify(result, null, 2));

      const mismatches = compareAttendance(day.expected, await api.listAttendance(), lectureIds);
      if (mismatches.length) {
        console.error(`${mismatches.length} attendance rows differ from the simulation:`);
        console.error(JSON.stringify(mismatches.slice(0, 10), null, 2));
        process.exitCode = 1;
      } else {
        console.log(`All ${day.expected.length} attendance rows match the simulation.`);
      }
      return;
    }

    case "scan": {
      if (!values.device || !values.palm) throw new Error("scan needs --device and --palm");
      const scan = {
        device_id: values.device,
        student_palm: values.palm,
        scan_time: values.at ?? toDohaIso(Date.now()),
      };
      await api.sendScan(scan);
      const mapping = await api.processMappings();
      const date = scan.scan_time.slice(0, 10);
      const attendance = await api.processAttendance({ from_date: date, to_date: date });
      console.log(JSON.stringify({ scan, mapping, attendance }, null, 2));
      return;
    }

    case "catch-up": {
      const until = values.until ? Date.parse(values.until) : Date.now();
      if (Number.isNaN(until)) throw new Error("--until must be an ISO date-time");
      const from = values.from ?? addDays(todayInDoha(until), -1);
      const parameters = await readParameters();
      const { catchUp } = await import("../src/simulator/catchUp.js");
      const days = await withPool((pool) => catchUp({ campus, pool, transport: api, parameters, from, until, verifyComplete: values.verify }));
      for (const day of days) {
        console.log(
          `${day.date}: sent ${day.sent}, ${day.pending} still to come` +
            (day.mismatches === undefined ? "" : `, ${day.mismatches} attendance mismatches`),
        );
      }
      if (days.some((d) => d.mismatches)) process.exitCode = 1;
      return;
    }

    default:
      console.log(
        "Usage: npm run sim -- <campus | seed | day | scan | catch-up> [--date YYYY-MM-DD] [--from] [--to] [--until ISO] " +
          "[--speed N] [--live] [--dry-run] [--no-outages] [--device ID --palm ID --at ISO] [--api URL]",
      );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
