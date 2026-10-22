# UREP Attendance API

TypeScript Express API for the UREP student attendance PALM reader project.

## Requirements

- Node.js 22+
- Docker and Docker Compose

## Local Setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run migrate
npm run seed
npm run dev
```

The API runs on `http://localhost:3000`.

## Docker Setup

```bash
docker compose up --build
```

The API container runs migrations before starting.

## Test Database

Start the test database:

```bash
docker compose --profile test up -d test-postgres
npm test
```

If the test database is not running, integration tests are skipped.

## Useful Commands

```bash
npm run build
npm run migrate
npm run seed
npm test
```

## Example Requests

```bash
curl http://localhost:3000/health
curl http://localhost:3000/parameters
```

```bash
curl -X POST http://localhost:3000/time-logs \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"device-b-101\",\"student_palm\":\"demo-palm-1\",\"scan_time\":\"2026-06-09T09:05:00+03:00\"}"
```

```bash
curl -X POST http://localhost:3000/time-log-mappings/process
curl -X POST http://localhost:3000/attendance/process -H "Content-Type: application/json" -d "{}"
curl http://localhost:3000/attendance
```

An offline reader flushes its buffer in one request:

```bash
curl -X POST http://localhost:3000/time-logs/batch \
  -H "Content-Type: application/json" \
  -d "{\"scans\":[{\"device_id\":\"WP500-Q24A0101\",\"student_palm\":\"PV-1\",\"scan_time\":\"2026-10-25T08:01:00+03:00\"}]}"
```

A read-only public view runs at https://attendance-api.alirezaafshan.com (simulated data; writes are not exposed). The student app reads one student's data in a single call:

```bash
curl http://localhost:3000/students/60301855/overview
```

## Palm Reader Simulator

Until the WavePass500 readers can post to the API, `npm run sim` plays their part: a seeded campus with rooms, readers, a Sunday to Thursday timetable and students, and realistic scan traffic (late arrivals, duplicates, wrong-room scans, unknown palms, reader clock drift and offline buffering). Each run checks the API's attendance against what the simulation expects.

```bash
npm run sim -- seed --from 2026-10-25 --to 2026-10-29
npm run sim -- day --date 2026-10-25
npm run sim -- day --date 2026-10-25 --speed 60 --live
```

See [docs/data-flow.md](docs/data-flow.md) for the full flow and [docs/erd.png](docs/erd.png) for the schema diagram.

If another PostgreSQL already listens on `localhost:5432`, point `DATABASE_URL` at a free port.
