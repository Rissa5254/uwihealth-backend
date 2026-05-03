const express = require("express");
const router = express.Router();
const { register, login} = require("../controllers/authController");
const { bookAppointment, getMyAppointments, checkInPatient, completeAppt, 
        getWaitTime, getQueue,cancelAppt, nowServing} = require("../controllers/appointmentController");

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

module.exports = router;