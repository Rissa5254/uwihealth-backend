const pool = require("../config/db");
const bcrypt = require("bcrypt");

// REGISTER
async function register(req, res) {
  const { fname, lname, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO Users (fname, lname, email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, fname, lname, email`,
      [fname, lname, email, hashedPassword]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
}

// LOGIN
async function login(req, res) {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM Users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ error: "Invalid password" });
    }

    res.json({
      id: user.id,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
}

module.exports = { register, login,};