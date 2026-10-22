<!-- al-stack:project:start -->
## Al-stack project

Project: urep. Profile: general. Status: experimental.

Attendance API for the UREP 32 palm-reader project: ingests reader scans, maps them to students and rooms, and computes lecture attendance in PostgreSQL

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- dev: `npm run dev`
- test: `npm test`
- build: `npm run build`
- sim: `npm run sim -- day --date 2026-10-25`

Edit project guidance outside this managed section. Use `al-stack configure` for its fields and `al-stack check .` for setup checks. Run the actual project checks for behavioral validation.
<!-- al-stack:project:end -->

## UREP attendance API

Backend for the UREP 32 palm-reader attendance project (UDST). The supervisors are Dr. Wagdi Alrawagfeh (PI) and Dr. Ghassan Al Noubani, who wrote the ERM this schema implements. Alireza Afshan leads the mobile app. Its repo, `urep-student-attendance/mobile-app`, mirrors this API's rules in `src/domain/pipeline.ts`, so keep the reason strings and window rules identical in both.

### Run and check

- `docker compose --profile test up -d test-postgres`, then `npm test`. Integration suites skip silently when PostgreSQL is unreachable, so confirm that they actually ran.
- `npx tsc --noEmit -p .` typechecks src, scripts and tests.
- `npm run sim -- day --date YYYY-MM-DD` against a running API is the end-to-end check. It must report that all attendance rows match the simulation.

### Decisions

- The reader is the WavePass500 (PalmSDK-L server version, Android SDK). Palm templates stay on the reader or PalmSDK side. This API stores only the palm ID the reader reports (`student_palm`).
- `time_log.time` is the reader's clock, not the arrival time, so buffered scans count. Reader clock drift therefore changes outcomes.
- Campus time is Asia/Qatar (UTC+3, no DST). `ATTENDANCE_TIME_ZONE` defaults to Asia/Riyadh, which has the same offset.
- `src/simulator/` is deterministic per seed. It derives the expected attendance independently of the SQL, which is what makes it useful as an oracle. Don't make it call the API's rules.
- `docs/erd.png` and `docs/erd.svg` are rendered from `docs/erd.mmd` with `npx -y @mermaid-js/mermaid-cli@11.4.2 -i docs/erd.mmd -o docs/erd.png -b white -s 2 -w 1600`.
- `GET /students/:id/overview` serves the student app (`urep-student-attendance/mobile-app`, through its `/api` proxy). It has no authentication, which is acceptable only while the data is simulated.
- Migration 003 adds SIS display fields (`students`, `courses.title`, `schedule.instructor`). They are nullable and never used by the attendance logic.
- `.DONOTCOMMIT/` holds private WhatsApp exports, and `*.pdf` and `*.docx` are ignored. Never commit them.
