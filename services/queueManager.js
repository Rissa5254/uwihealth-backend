const pool = require("../config/db");

function generateTicketNumber(position) {
  return `W${String(position).padStart(3, "0")}`;
}

async function getAverageServiceTime(doctorId) {
  const result = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM s.duration)/60) AS avg_duration
    FROM Schedule s
    WHERE s.did = $1 AND s.is_canceled = false
  `, [doctorId]);

  return parseFloat(result.rows[0].avg_duration) || null;
}

async function getPolicy() {
  const result = await pool.query(`
    SELECT * FROM "Policies"
    ORDER BY effective_date DESC
    LIMIT 1
  `);

  return result.rows[0];
}

// CHECK-IN

async function checkIn(userId, apptId, doctorId, date) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Prevents duplicate check-in
    const exists = await client.query(
      `SELECT * FROM Check_in WHERE id = $1 AND apid = $2`,
      [userId, apptId]
    );

    if (exists.rows.length > 0) {
      await client.query("ROLLBACK");
      throw new Error("User already checked in");
    }

    const result = await client.query(
      `SELECT COALESCE(MAX(ci.queue_position), 0) AS max_pos
       FROM Check_in ci
       JOIN Schedule s ON ci.apid = s.apid
       WHERE s.did = $1
       AND s.sdate >= $2::date
       AND s.sdate < ($2::date + INTERVAL '1 day')`,
      [doctorId, date]
    );

    const position = result.rows[0].max_pos + 1;

    const ticketResult = await client.query(`
      SELECT MAX(ci.ticket_number) AS last_ticket
      FROM check_in ci
      JOIN Schedule s ON ci.apid = s.apid
      WHERE s.did = $1
      AND s.sdate >= $2::date
      AND s.sdate < ($2::date + INTERVAL '1 day')
    `, [doctorId, date]);

    let nextNumber = 1;

    if (ticketResult.rows[0].last_ticket) {
      const last = ticketResult.rows[0].last_ticket;
      nextNumber = parseInt(last.replace("W", "")) + 1;
    }

    const ticketNumber = `W${String(nextNumber).padStart(3, "0")}`;

    console.log("Doctor:", doctorId);
    console.log("Date:", date);
    console.log("Max position:", result.rows[0].max_pos);

    await client.query(
      `INSERT INTO Check_in (id, apid, queue_position, ticket_number, status)
       VALUES ($1, $2, $3, $4, 'Waiting')`,
      [userId, apptId, position, ticketNumber]
    );

    await client.query("COMMIT");

    return { position, ticketNumber };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// COMPLETE APPOINTMENT
async function completeAppointment(doctorId, date) {
  const current = await pool.query(
    `SELECT ci.apid, ci.queue_position, ci.id AS user_id, s.did AS doctor_id, s.sdate
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     WHERE s.did = $1
       AND s.sdate >= $2::date
       AND s.sdate < ($2::date + INTERVAL '1 day')
     ORDER BY ci.queue_position ASC
     LIMIT 1`,
    [doctorId, date]
  );

  if (current.rows.length === 0) {
  // fallback: completes first scheduled appointment instead
  const fallback = await pool.query(
    `SELECT apid, id AS user_id, did AS doctor_id, sdate
     FROM Schedule
     WHERE did = $1
     AND sdate >= $2::date
     AND sdate < ($2::date + INTERVAL '1 day')
     AND status = 'scheduled'
     ORDER BY stime ASC
     LIMIT 1`,
    [doctorId, date]
  );

  if (fallback.rows.length === 0) {
    return null;
  }

  const { apid, user_id, doctor_id, sdate } = fallback.rows[0];

  await pool.query(
    `UPDATE Schedule 
     SET status = 'completed'
     WHERE apid = $1`,
    [apid]
  );

  return {
    completed: apid,
    nowServing: null
  };
}

  const {
    apid,
    queue_position,
    user_id,
    doctor_id,
    sdate
  } = current.rows[0];

  await pool.query(
    `INSERT INTO Completed_Appointments (apid, user_id, doctor_id, date)
     VALUES ($1, $2, $3, $4)`,
    [apid, user_id, doctor_id, sdate]
  );

  await pool.query(
  `UPDATE Schedule 
   SET status = 'completed' 
   WHERE apid = $1`,
  [apid]
);

  await pool.query(
    `DELETE FROM Check_in
     WHERE apid = $1`,
    [apid]
  );

  

  await pool.query(
    `UPDATE Check_in
     SET queue_position = queue_position - 1
     WHERE queue_position > $1`,
    [queue_position]
  );

  const next = await pool.query(
    `SELECT ci.queue_position, ci.ticket_number, u.fname, u.lname
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     JOIN Users u ON ci.id = u.id
     WHERE s.did = $1
       AND s.sdate >= $2::date
       AND s.sdate < ($2::date + INTERVAL '1 day')
     ORDER BY ci.queue_position ASC
     LIMIT 1`,
    [doctorId, date]
  );

  let nowServing = null;

  if (next.rows.length > 0) {
    nowServing = {
      queue_position: next.rows[0].queue_position,
      ticket_number: next.rows[0].ticket_number,
      patientName: `${next.rows[0].fname} ${next.rows[0].lname}`
    };
  }

  return {
    completed: apid,
    nowServing
  };
}

// WAIT TIME
async function getEstimatedWaitTime(doctorId, date) {
  const result = await pool.query(
    `SELECT AVG(s.duration) AS avg_duration
     FROM Schedule s
     WHERE s.did = $1
     AND s.sdate >= $2::date
     AND s.sdate < ($2::date + INTERVAL '1 day')`,
    [doctorId, date]
  );

  const avgDuration = parseFloat(result.rows[0].avg_duration) || 20;

  const queue = await pool.query(
    `SELECT COUNT(*) FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     WHERE s.did = $1 AND s.sdate >= $2::date AND s.sdate < ($2::date + INTERVAL '1 day')`,
    [doctorId, date]
  );

  const queueLength = parseInt(queue.rows[0].count);

  return Math.round(queueLength * avgDuration);
}

async function promoteFromWaitlist(doctorId, date) {
  const waitlist = await pool.query(
    `SELECT * FROM Waitlist 
     WHERE did = $1 AND wdate = $2 
     ORDER BY created_at ASC 
     LIMIT 1`,
    [doctorId, date]
  );

  if (waitlist.rows.length === 0) {
    console.log("No one in waitlist");
    return null;
  }

  const person = waitlist.rows[0];

  const result = await pool.query(
    `INSERT INTO Schedule (id, did, sdate, stime, duration, is_canceled)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING apid`,
    [
      person.id,
      person.did,
      person.wdate,
      person.wtime,
      person.duration,
    ]
  );

  await pool.query(
    `DELETE FROM Waitlist WHERE wid = $1`,
    [person.wid]
  );

  console.log("Promoted from waitlist");

  return result.rows[0].apid;
}

async function getQueueStatus(doctorId, date) {
 const result = await pool.query(
  `SELECT 
      ci.queue_position,
      ci.ticket_number,
      u.fname,
      u.lname,
      s.stime,
      s.duration
   FROM Check_in ci
   JOIN Schedule s ON ci.apid = s.apid
   JOIN Users u ON ci.id = u.id
   WHERE s.did = $1
   AND s.sdate >= $2::date
   AND s.sdate < ($2::date + INTERVAL '1 day')
   ORDER BY ci.queue_position ASC`,
  [doctorId, date]
);
  console.log("DoctorId from API:", doctorId);
  console.log("Date from API:", date);

  const policyResult = await pool.query(`
    SELECT * FROM "Policies"
    ORDER BY effective_date DESC
    LIMIT 1
  `);

  const policy = policyResult.rows[0];

  // GETs HISTORICAL AVERAGE ONCE
  const avgResult = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM s.duration)/60) AS avg_duration
    FROM Schedule s
    WHERE s.did = $1 AND s.is_canceled = false
  `, [doctorId]);

  const avgServiceTime = parseFloat(avgResult.rows[0].avg_duration);

  let cumulativeTime = 0;
  const queue = [];

  for (const row of result.rows) {
    const waitTime = cumulativeTime;

    let durationMinutes = 10; // default fallback

    if (avgServiceTime && !isNaN(avgServiceTime)) {
      durationMinutes = avgServiceTime;
    } 
    else if (row.duration) {
      durationMinutes = parseInt(row.duration.split(":")[1]);
    } 
    else if (policy && policy.appointmentduration) {
      durationMinutes = policy.appointmentduration;
    }

    cumulativeTime += durationMinutes;

    queue.push({
      queue_position: row.queue_position,
      ticket_number: row.ticket_number,
      patientName: `${row.fname} ${row.lname}`,
      appointmentTime: row.stime,
      estimatedWait: Math.round(waitTime)
    });
  }
  return queue;
}

async function cancelAppointment(apid, doctorId, date) {
  const result = await pool.query(
    `SELECT queue_position 
     FROM Check_in 
     WHERE apid = $1`,
    [apid]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const removedPosition = result.rows[0].queue_position;

  // remove from queue
  await pool.query(
    `DELETE FROM Check_in 
     WHERE apid = $1`,
    [apid]
  );

  // shift positions
  await pool.query(
    `UPDATE Check_in
     SET queue_position = queue_position - 1
     WHERE queue_position > $1`,
    [removedPosition]
  );

  const updatedQueue = await getQueueStatus(doctorId, date);

  return updatedQueue;
}

async function getNowServing(doctorId, date) {
  const current = await pool.query(
    `SELECT 
        ci.queue_position,
        ci.ticket_number,
        u.fname,
        u.lname
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     JOIN Users u ON ci.id = u.id
     WHERE s.did = $1
       AND s.sdate >= $2::date
       AND s.sdate < ($2::date + INTERVAL '1 day')
       AND ci.status = 'In-Progress'
     LIMIT 1`,
    [doctorId, date]
  );

  if (current.rows.length === 0) {
    const next = await pool.query(
      `SELECT 
          ci.queue_position,
          ci.ticket_number,
          u.fname,
          u.lname
       FROM Check_in ci
       JOIN Schedule s ON ci.apid = s.apid
       JOIN Users u ON ci.id = u.id
       WHERE s.did = $1
         AND s.sdate >= $2::date
         AND s.sdate < ($2::date + INTERVAL '1 day')
         AND ci.status = 'Waiting'
       ORDER BY ci.queue_position ASC
       LIMIT 1`,
      [doctorId, date]
    );

    return next.rows[0]
      ? {
          queue_position: next.rows[0].queue_position,
          ticket_number: next.rows[0].ticket_number,
          patientName: `${next.rows[0].fname} ${next.rows[0].lname}`
        }
      : null;
  }

  return {
    queue_position: current.rows[0].queue_position,
    ticket_number: current.rows[0].ticket_number,
    patientName: `${current.rows[0].fname} ${current.rows[0].lname}`
  };
}

module.exports = {
  checkIn,
  completeAppointment,
  getEstimatedWaitTime,
  promoteFromWaitlist,
  getQueueStatus,
  cancelAppointment,
  getNowServing,
  getPolicy
};