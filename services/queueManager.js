const pool = require("../config/db");

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
       WHERE s.did = $1 AND DATE(s.sdate) = $2`,
      [doctorId, date]);

    const position = result.rows[0].max_pos + 1;
    console.log("Doctor:", doctorId);
    console.log("Date:", date);
    console.log("Max position:", result.rows[0].max_pos);

    await client.query(
      `INSERT INTO Check_in (id, apid, queue_position, status)
       VALUES ($1, $2, $3, 'Waiting')`,
      [userId, apptId, position]
    );

    await client.query("COMMIT");

    return position;

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// COMPLETE APPOINTMENT
async function completeAppointment(doctorId, date) {
  // 1. Find current patient
  const current = await pool.query(
    `SELECT ci.apid, ci.queue_position, ci.id AS user_id, s.did AS doctor_id, s.sdate
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     WHERE s.did = $1
       AND DATE(s.sdate) = DATE($2)
     ORDER BY ci.queue_position ASC
     LIMIT 1`,
    [doctorId, date]
  );

  if (current.rows.length === 0) {
    return null;
  }

  const {
    apid,
    queue_position,
    user_id,
    doctor_id,
    sdate
  } = current.rows[0];

  // 2. INSERT into Completed_Appointments Table
  await pool.query(
    `INSERT INTO Completed_Appointments (apid, user_id, doctor_id, date)
     VALUES ($1, $2, $3, $4)`,
    [apid, user_id, doctor_id, sdate]
  );

  // 3. DELETE from Check_in
  await pool.query(
    `DELETE FROM Check_in
     WHERE apid = $1`,
    [apid]
  );

  // 4. SHIFT queue positions
  await pool.query(
    `UPDATE Check_in
     SET queue_position = queue_position - 1
     WHERE queue_position > $1`,
    [queue_position]
  );

  // 5. Get next patient
  const next = await pool.query(
    `SELECT ci.queue_position, u.fname, u.lname
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     JOIN Users u ON ci.id = u.id
     WHERE s.did = $1
       AND DATE(s.sdate) = DATE($2)
     ORDER BY ci.queue_position ASC
     LIMIT 1`,
    [doctorId, date]
  );

  let nowServing = null;

  if (next.rows.length > 0) {
    nowServing = {
      queue_position: next.rows[0].queue_position,
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
     WHERE s.did = $1 AND DATE(s.sdate) = DATE($2)`,
    [doctorId, date]
  );

  const avgDuration = parseFloat(result.rows[0].avg_duration) || 20;

  const queue = await pool.query(
    `SELECT COUNT(*) FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     WHERE s.did = $1 AND DATE(s.sdate) = DATE($2)`,
    [doctorId, date]
  );

  const queueLength = parseInt(queue.rows[0].count);

  return Math.round(queueLength * avgDuration);
}

async function promoteFromWaitlist(doctorId, date) {
  // 1. Gets the first person in waitlist
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

  // 2. Insert into Schedule
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

  // 3. Remove from waitlist
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
        u.fname,
        u.lname,
        s.stime,
        s.duration
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     JOIN Users u ON ci.id = u.id
     WHERE s.did = $1 AND DATE(s.sdate) = DATE($2)
     ORDER BY ci.queue_position ASC`,
    [doctorId, date]
  );

  let cumulativeTime = 0;

  const queue = result.rows.map((row, index) => {
    const waitTime = cumulativeTime;
    cumulativeTime += row.duration;

    return {
      queue_position: row.queue_position,
      patientName: `${row.fname} ${row.lname}`,
      appointmentTime: row.stime,
      estimatedWait: waitTime
    };
  });

  return queue;
}

async function cancelAppointment(apid) {
  // 1. Get the queue position BEFORE deleting
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

  // 2. Delete from queue
  await pool.query(
    `DELETE FROM Check_in 
     WHERE apid = $1`,
    [apid]
  );

  // 3. Shift everyone behind forward
  await pool.query(
    `UPDATE Check_in
     SET queue_position = queue_position - 1
     WHERE queue_position > $1`,
    [removedPosition]
  );

  return removedPosition;
}

//Maybe
async function getNowServing(doctorId, date) {
  // 1. Try to find someone In-Progress
  const current = await pool.query(
    `SELECT 
        ci.queue_position,
        u.fname,
        u.lname
     FROM Check_in ci
     JOIN Schedule s ON ci.apid = s.apid
     JOIN Users u ON ci.id = u.id
     WHERE s.did = $1
       AND DATE(s.sdate) = DATE($2)
       AND ci.status = 'In-Progress'
     LIMIT 1`,
    [doctorId, date]
  );

  // 2. If none, get first Waiting
  if (current.rows.length === 0) {
    const next = await pool.query(
      `SELECT 
          ci.queue_position,
          u.fname,
          u.lname
       FROM Check_in ci
       JOIN Schedule s ON ci.apid = s.apid
       JOIN Users u ON ci.id = u.id
       WHERE s.did = $1
         AND DATE(s.sdate) = DATE($2)
         AND ci.status = 'Waiting'
       ORDER BY ci.queue_position ASC
       LIMIT 1`,
      [doctorId, date]
    );

    return next.rows[0] || null;
  }

  return current.rows[0];
}

module.exports = {
  checkIn,
  completeAppointment,
  getEstimatedWaitTime,
  promoteFromWaitlist,
  getQueueStatus,
  cancelAppointment,
  getNowServing
};