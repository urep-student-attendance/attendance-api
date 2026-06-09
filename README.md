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
