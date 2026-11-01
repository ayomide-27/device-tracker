// "Today", "this week" and day boundaries, counted in the configured time zone.
// Postgres knows time zones, so the arithmetic is done there rather than re-implemented.
export function createCalendarStore(db, timezone) {
  return {
    // The moments a day (or several days) starts and ends. date looks like 2026-10-31.
    async range(date, days = 1) {
      const [row] = await db.query(
        `SELECT ($1::date::timestamp AT TIME ZONE $2) AS start_at,
                (($1::date + $3::int)::timestamp AT TIME ZONE $2) AS end_at`,
        [date, timezone, days]
      );
      return { start: row.start_at, end: row.end_at };
    },

    // Today's date (like 2026-10-31) where the supervisors are.
    async today() {
      const [row] = await db.query('SELECT (now() AT TIME ZONE $1)::date::text AS today', [timezone]);
      return row.today;
    },

    // The Monday of the week containing the given date (or today).
    async weekStart(date = null) {
      const [row] = await db.query(
        `SELECT date_trunc('week', COALESCE($1::date, (now() AT TIME ZONE $2)::date))::date::text AS week_start`,
        [date, timezone]
      );
      return row.week_start;
    },
  };
}
