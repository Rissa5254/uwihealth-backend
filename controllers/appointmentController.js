const pool = require("../config/db");
const {
  isSlotAvailable,
  canBook,
} = require("../services/schedulingEngine");

const {
  checkIn,
  completeAppointment,
  getEstimatedWaitTime,
  getQueueStatus,
  getNowServing,
  cancelAppointment,
  getPolicy
} = require("../services/queueManager");


async function bookAppointment(req, res) {
  const { userId, doctorId, date, time, duration } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const available = await isSlotAvailable(doctorId, date, time, duration);
    if (!available) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Sorry! Slot is not available. Please choose another time" });
    }

    const policy = await getPolicy();
    const allowed = await canBook(doctorId, date, policy.maxdailyappointments);
    if (!allowed) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Max bookings reached" });
    }
    const existing = await client.query(
  `SELECT * FROM Schedule 
   WHERE did = $1
   AND sdate >= $2::date
   AND sdate < ($2::date + INTERVAL '1 day')
   AND stime = $3
   AND status = 'scheduled'`,
  [doctorId, date, time]
);

    if (existing.rows.length > 0) {
        return res.status(400).json({ error: "Time slot already booked. Please choose another time" });}

    const result = await client.query(
      `INSERT INTO Schedule (id, did, sdate, stime, duration, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING apid`,
      [userId, doctorId, date, time, duration]
    );

    await client.query("COMMIT");

    res.json({
      message: "Success! Appointment is booked",
      appointmentId: result.rows[0].apid,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Sorry!, Booking failed" });
  } finally {
    client.release();
  }

}

async function getMyAppointments(req, res) {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT apid, id, did, sdate, stime, duration,status, is_canceled
       FROM Schedule
       WHERE id = $1 
       ORDER BY sdate, stime`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
}

async function checkInPatient(req, res) {
  const { userId, appointmentId, doctorId, date } = req.body;

  try {
    const result = await checkIn(userId, appointmentId, doctorId, date);
    
res.json({
  message: "Checked in successfully",
  queuePosition: result.position,
  ticketNumber: result.ticketNumber
});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sorry! Check-in failed. Please try again." });
  }
}

async function completeAppt(req, res) {
  const { doctorId, date } = req.body;

  try {
    if (!doctorId || !date) {
      return res.status(400).json({ error: "doctorId and date are required" });
    }

    const result = await completeAppointment(doctorId, date);

    if (!result) {
      return res.json({ message: "ERROR. There are no patients in queue" });
    }

    res.json({
      message: "Success! Appointment completed and queue updated",
      completed: result.completed,
      nowServing: result.nowServing
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sorry! Completion failed" });
  }
}

async function getWaitTime(req, res) {
  const { doctorId, date } = req.params;

  try {
    const waitTime = await getEstimatedWaitTime(doctorId, date);

    res.json({
      doctorId,
      estimatedWaitTime: waitTime,
      unit: "minutes",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: " Sorry! Failed to get wait time" });
  }
}

const getQueue = async (req, res) => {
  const { doctorId, date } = req.params;

  try {
    const queue = await getQueueStatus(doctorId, date);

    console.log("QUEUE DATA:", queue);

    res.json({ queue });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch queue" });
  }
};

const cancelAppt = async (req, res) => {
  const { appointmentId, doctorId, date } = req.body;

  console.log("CANCEL HIT:", appointmentId);

  try {
    // 1. mark appointment as canceled
    await pool.query(
      `UPDATE schedule SET status = 'canceled', is_canceled = true WHERE apid = $1`,
      [appointmentId]
    );

    // fetch correct doctorId + date from DB 
    const appt = await pool.query(
      `SELECT did, sdate FROM Schedule WHERE apid = $1`,
      [appointmentId]
    );

    const doctorIdFinal = doctorId || appt.rows[0].did;
    const dateFinal = date || appt.rows[0].sdate;

    // update queue using correct values
    const updatedQueue = await cancelAppointment(
      appointmentId,
      doctorIdFinal,
      dateFinal
    );

    // 4. send response
    res.json({
      message: "Appointment cancelled successfully",
      queue: updatedQueue
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cancel failed" });
  }
};

async function nowServing(req, res) {
  const { doctorId, date } = req.params;

  try {
    const result = await getNowServing(doctorId, date);

  res.json({
  doctorId,
  nowServing: result
});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error getting now serving" });
  }
}

module.exports = {getMyAppointments, bookAppointment,checkInPatient,completeAppt,getWaitTime,getQueue,cancelAppt,nowServing};