const pool = require("../config/db");
const bcrypt = require("bcrypt");

let email1= "";

// REGISTER
async function register(req, res) {
  const { fname, lname, email, password, role } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO Users (fname, lname, email, password,role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, fname, lname, email, role`,
      [fname, lname, email, hashedPassword, role]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
}
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

async function login(req, res) {
  const { email, password, role } = req.body;
  email1 = email;

  try {
    const result = await pool.query(
      `SELECT * FROM Users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const user = result.rows[0];

    if (user.role !== role) {
      return res.status(400).json({ error: "Invalid role selected" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ error: "Invalid password" });
    }
    res.json({
      id: user.id,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      role: user.role,
      did: user.did 
    });
  //email1= getEmail(req,res)
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
}

module.exports = { register, login,};