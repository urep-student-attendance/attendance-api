import { pool } from "../db.js";
import { HttpError } from "../errors.js";

export type Parameter = {
  name: string;
  value: number | null;
  description: string;
  updated_at: string;
};

export async function listParameters() {
  const result = await pool.query<Parameter>(
    "SELECT name, value, description, updated_at FROM parameters ORDER BY name",
  );
  return result.rows;
}

export async function updateParameter(name: string, value: number | null) {
  if (!["Time_before_lecture_start", "Time_after_lecture_start"].includes(name)) {
    throw new HttpError(404, `Unknown parameter: ${name}`);
  }

  if (name === "Time_before_lecture_start" && value === null) {
    throw new HttpError(400, "Time_before_lecture_start cannot be null");
  }

  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new HttpError(400, "Parameter value must be a non-negative integer or null");
  }

  const result = await pool.query<Parameter>(
    `
      UPDATE parameters
      SET value = $2, updated_at = now()
      WHERE name = $1
      RETURNING name, value, description, updated_at
    `,
    [name, value],
  );

  if (!result.rowCount) {
    throw new HttpError(404, `Unknown parameter: ${name}`);
  }

  return result.rows[0];
}
