import "dotenv/config";

export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  attendanceTimeZone: string;
};

export function getConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    databaseUrl,
    attendanceTimeZone: process.env.ATTENDANCE_TIME_ZONE ?? "Asia/Riyadh",
  };
}
