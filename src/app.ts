import cors from "cors";
import express from "express";
import { attendanceRouter } from "./routes/attendance.js";
import { parametersRouter } from "./routes/parameters.js";
import { timeLogMappingsRouter } from "./routes/timeLogMappings.js";
import { timeLogsRouter } from "./routes/timeLogs.js";
import { pool } from "./db.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", async (_req, res, next) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/parameters", parametersRouter);
  app.use("/time-logs", timeLogsRouter);
  app.use("/time-log-mappings", timeLogMappingsRouter);
  app.use("/attendance", attendanceRouter);

  app.use(errorHandler);

  return app;
}
