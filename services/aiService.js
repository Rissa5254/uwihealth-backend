const ort = require("onnxruntime-node");
const path = require("path");
// const {get_id_by_email} =require("../controllers/authController");
//let { email1 } = require("../controllers/authController");
// const { get } = require("../routes/appointmentRoutes");
//const{getQueuelength, getwaitingTime,get_id_by_email,getEmail} = require("./queueManager");


let session;

// async function get_id_by_email() {
//   try {
//     const result = await pool.query(
//       `SELECT id FROM Users WHERE email = $1`,
//       [email1]
//     );
//     return result.rows[0].id;
//   } catch (err) {
//     console.error(err);
//     throw new Error("Failed to get user ID by email");
//   }
// }
// // LOGIN
// async function getEmail(req,res){
//   //email= req.body.email;
//   email=res["email"];
//  // res.json({ email: email1 });
//   return email
// }

// async function getqueueLength() {
//  const userId = await get_id_by_email();
//  const date = new Date("2024-12-25");
//   const appointment_id = await pool.query(
//     `SELECT appointment_id FROM schedule WHERE 
//     id = $1 AND sdate = $2`,
//     [userIdd, date]
//   );
 
//   const qid = await pool.query(
//     `SELECT qid FROM Check_in WHERE 
//     appointment_id = $1 AND sdate = $2`,
//     [appointment_id, date]
//   );
//  const queue_position= await pool.query(
//     `SELECT queue_position FROM Check_in WHERE status = 'waiting'
//     qid = $1`,
//     [qid]
//   );
//   return parseInt(queueposition.rows[0].count, 10);
// }

// async function getwaitingTime() {
//   let queueLength = await getqueueLength();
//   const avgServiceTime = 40; // Fallback average service time in minutes
//   return queueLength * avgServiceTime;
// }

async function loadModel() {
  if (!session) {
    const modelPath = path.join(__dirname, "../models/random_forest_model.onnx");
    session = await ort.InferenceSession.create(modelPath);
  }
}


async function predictConsultationTime(queueLength, waitingTime) {
  await loadModel();
  const now = new Date();
  const totalMinutes = now.getTime() / (1000 * 60);
 // const waitingTime = await getwaitingTime();
 // const queueLength = await getqueueLength();

// ArrivalTime, WaitingTimeT, QueueCountBeforeProcessing, est Time
  const tensor = new ort.Tensor(
    "float32",
    Float32Array.from([
      totalMinutes,
      waitingTime,
      queueLength
    ]),
    [1, 3]
  );
 console.log("Float32Array:", tensor.data);
  const results = await session.run({
    float_input: tensor
  });

  const value = results.variable.cpuData[0];

  let prediction = Math.abs(value);

prediction = prediction * 5; // Scale the prediction to a more realistic range

// Baseline consultation time
prediction = prediction + 8;

// Realistic bounds
prediction = Math.max(8, prediction);
prediction = Math.min(45, prediction);

return Math.round(prediction);
}

module.exports = {
  predictConsultationTime,
  predictDuration: predictConsultationTime
};