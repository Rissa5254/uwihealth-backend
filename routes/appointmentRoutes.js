const express = require("express");
const router = express.Router();
const { register, login} = require("../controllers/authController");
const { bookAppointment, getMyAppointments, checkInPatient, completeAppt, 
        getWaitTime, getQueue,cancelAppt, nowServing} = require("../controllers/appointmentController");
const { generateSlots, getPolicy } = require("../services/schedulingEngine");

const pool = require("../config/db");

router.post("/register", register);
router.post("/login", login);
router.post("/book", bookAppointment);
router.get("/my-appointments/:userId", getMyAppointments);
router.post("/checkin", checkInPatient);
router.post("/complete", completeAppt);
router.get("/waittime/:doctorId/:date", getWaitTime);
router.get("/queue/:doctorId/:date", getQueue);
router.post("/cancel", cancelAppt);
router.get("/now-serving/:doctorId/:date", nowServing);
router.get("/slots/:doctorId/:date", async (req, res) => {
  const { doctorId, date } = req.params;

  const policy = await getPolicy();

  const slots = generateSlots(
    "09:00",
    "16:00",
    policy.appointmentduration,
    policy.buffertime
  );

  res.json(slots);
});

router.get("/doctor-schedule/:doctorId/:date", async (req, res) => {
  const { doctorId, date } = req.params;

 try {
  const result = await pool.query(
    `SELECT s.stime, s.duration, s.apid,
            COALESCE(ci.status, 'Waiting') AS status,
            u.fname || ' ' || u.lname AS patient
     FROM Schedule s
     JOIN Users u ON s.id = u.id
     LEFT JOIN Check_in ci ON s.apid = ci.apid
     WHERE s.did = $1
     AND s.sdate >= $2::date
     AND s.sdate < ($2::date + INTERVAL '1 day')
     AND s.status = 'scheduled'
     ORDER BY s.stime ASC`,
    [doctorId, date] );

  res.json({ schedule: result.rows });

} catch (err) {
  console.error(err);
  res.status(500).json({ error: "Failed to fetch schedule" });
}
});

router.get("/doctors", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT did AS id,
              fname || ' ' || lname AS name,
              speciality
       FROM doctor
       WHERE doctor_status = 'Available'`
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch doctors" });
  }
});

router.put("/update-status", async (req, res) => {
  const { apid, status } = req.body;

  try {
    await pool.query(
      `UPDATE Check_in SET status = $1 WHERE apid = $2`,
      [status, apid]
    );

    res.json({ message: "Status updated" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.put("/doctor-status", async (req, res) => {
  const { doctorId, status } = req.body;

  try {
    await pool.query(
      `UPDATE doctor SET doctor_status = $1 WHERE did = $2`,
      [status, doctorId]
    );

    res.json({ message: "Doctor status updated" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.get("/doctor-status/:doctorId", async (req, res) => {
  const { doctorId } = req.params;

  try {
    const result = await pool.query(
      `SELECT doctor_status FROM doctor WHERE did = $1`,
      [doctorId]
    );

    res.json({ status: result.rows[0]?.doctor_status });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch doctor status" });
  }
});

module.exports = router;