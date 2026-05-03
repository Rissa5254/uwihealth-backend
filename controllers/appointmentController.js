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
  cancelAppointment
} = require("../services/queueManager");


async function bookAppointment(req, res) {
  const { userId, doctorId, date, time, duration } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const available = await isSlotAvailable(doctorId, date, time);
    if (!available) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Sorry! Slot is not available. Please choose another time" });
    }

    const allowed = await canBook(doctorId, date, 20);
    if (!allowed) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Max bookings reached" });
    }
    const existing = await client.query(
    `SELECT * FROM Schedule 
    WHERE did = $1 AND sdate = $2 AND stime = $3 AND is_canceled = false`,
    [doctorId, date, time]);

    if (existing.rows.length > 0) {
        return res.status(400).json({ error: "Time slot already booked. Please choose another time" });}

    const result = await client.query(
      `INSERT INTO Schedule (id, did, sdate, stime, duration, is_canceled)
       VALUES ($1, $2, $3, $4, $5, false)
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
      `SELECT apid, id, did, sdate, stime, duration, is_canceled
       FROM Schedule
       WHERE id = $1 AND is_canceled = false
       ORDER BY sdate, stime`,
      [userId]
    );

    res.json({ appointments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
}

async function checkInPatient(req, res) {
  const { userId, appointmentId, doctorId, date } = req.body;

  try {
    const position = await checkIn(userId, appointmentId, doctorId, date);
    

    res.json({
      message: "Checked in successfully",
      queuePosition: position,
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

async function getQueue(req, res) {
  const { doctorId, date} = req.params;

  try {
    const queue = await getQueueStatus(doctorId, date);

    if (queue.length === 0) {
      return res.json({ message: "Sorry! There are no patients in queue" });
    }

    res.json({
      doctorId,
      queue,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error! Failed to get queue" });
  }
}

async function cancelAppt(req, res) {
  const { appointmentId } = req.body;

  try {
    const result = await cancelAppointment(appointmentId);

    if (!result) {
      return res.json({ message: " Sorry! Unable to locate appointment in queue" });
    }

    res.json({
      message: "Appointment cancelled and queue updated",
      removedPosition: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cancellation failed" });
  }
}

//Maybe
async function nowServing(req, res) {
  const { doctorId, date } = req.params;

  try {
    const result = await getNowServing(doctorId, date);

    if (!result) {
      return res.json({ message: "No patients are currently being served" });
    }

    res.json({
      doctorId,
      nowServing: {
        queue_position: result.queue_position,
        patientName: `${result.fname} ${result.lname}`
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error getting now serving" });
  }
}

module.exports = {getMyAppointments, bookAppointment,checkInPatient,completeAppt,getWaitTime,getQueue,cancelAppt,nowServing};