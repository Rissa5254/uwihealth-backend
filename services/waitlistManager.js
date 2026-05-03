const pool = require("../config/db");

async function promoteFromWaitlist(doctorId, date, time) {
  const result = await pool.query(
    `SELECT * FROM Waitlist 
     WHERE did = $1 AND wdate = $2 
     ORDER BY created_at ASC LIMIT 1`,
    [doctorId, date]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  const newAppt = await pool.query(
    `INSERT INTO Schedule (id, did, sdate, stime, duration, is_canceled)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING apid`,
    [user.id, doctorId, date, time, user.duration]
  );

  await pool.query(
    `DELETE FROM Waitlist WHERE wid = $1`,
    [user.wid]
  );

  return newAppt.rows[0];
}

module.exports = { promoteFromWaitlist };