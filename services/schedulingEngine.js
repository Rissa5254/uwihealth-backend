const pool = require("../config/db");

// Generate timeslots
function generateSlots(startTime, endTime, duration, buffer) {
  const slots = [];
  let current = new Date(`1970-01-01T${startTime}`);
  const end = new Date(`1970-01-01T${endTime}`);

  while (current < end) {
    slots.push(current.toTimeString().substring(0, 5));

      current = new Date(
      current.getTime() + 15 * 60000  
         );
  }

  return slots;
}

function getMinutes(duration, defaultValue = 10) {
  if (!duration) return defaultValue;

  const parts = duration.split(":");
  return parseInt(parts[1]);
}

async function isSlotAvailable(doctorId, date, time, duration) {

  const policy = await getPolicy();
  const defaultDuration = policy?.appointmentduration || 10;
  const bufferTime = policy?.buffertime || 0;

  const existing = await pool.query(
    `SELECT stime, duration 
     FROM Schedule 
     WHERE did = $1 AND sdate = $2 AND is_canceled = false`,
    [doctorId, date]
  );

  const newStart = new Date(`1970-01-01T${time}`);
  const newEnd = new Date(
    newStart.getTime() + getMinutes(duration, defaultDuration) * 60000
  );

  for (const row of existing.rows) {

    const existingStart = new Date(`1970-01-01T${row.stime}`);
    const existingEnd = new Date(
      existingStart.getTime() + getMinutes(row.duration, defaultDuration) * 60000
    );

    const existingEndWithBuffer = new Date(
      existingEnd.getTime() + bufferTime * 60000
    );

    if (newStart < existingEndWithBuffer && newEnd > existingStart) {
      return false;
    }
  }

  return true; 
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

// Get appointment remainders
async function getAppointmentRemainders(){
  const result = await pool.query(
    `SELECT s.*, u.email, u.fname 
    FROM Schedule s 
    JOIN users u ON s.id = u.id 
    WHERE s.sdate = CURRENT_DATE 
    AND s.stime > CURRENT_TIME 
    AND s.stime <= (CURRENT_TIME + INTERVAL '1 hour')
    AND s.is_canceled = false`
  );

  return result.rows;
}

async function getPolicy() {
  const result = await pool.query(`
    SELECT * FROM "Policies"
    ORDER BY effective_date DESC
    LIMIT 1
  `);

  return result.rows[0];
}

module.exports = {
  generateSlots,
  isSlotAvailable,
  canBook,
  getAppointmentRemainders,
  getPolicy,
};
