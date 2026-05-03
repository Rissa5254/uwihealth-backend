const pool = require("../config/db");

// Generate timeslots
function generateSlots(startTime, endTime, duration, buffer) {
  const slots = [];
  let current = new Date(`1970-01-01T${startTime}`);
  const end = new Date(`1970-01-01T${endTime}`);

  while (current < end) {
    slots.push(current.toTimeString().substring(0, 5));

    current = new Date(
      current.getTime() + (duration + buffer) * 60000
    );
  }

  return slots;
}

// Checks if a slot is taken
async function isSlotAvailable(doctorId, date, time) {
  const result = await pool.query(
    `SELECT * FROM Schedule 
     WHERE did = $1 AND sdate = $2 AND stime = $3 AND is_canceled = false`,
    [doctorId, date, time]
  );

  return result.rows.length === 0;
}

// Checks MAX per day
async function canBook(doctorId, date, maxDaily) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM Schedule 
     WHERE did = $1 AND sdate = $2 AND is_canceled = false`,
    [doctorId, date]
  );

  return parseInt(result.rows[0].count) < maxDaily;
}

module.exports = {
  generateSlots,
  isSlotAvailable,
  canBook,
};