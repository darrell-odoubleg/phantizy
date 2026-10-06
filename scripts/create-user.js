// Create (or reset the password of) a user from the command line.
//   node scripts/create-user.js <email> "<Full Name>" [admin|staff|production]
// Prints a generated temporary password.

const crypto = require('crypto');
const db = require('../db/init');
const { hashPassword } = require('../server/auth');

const [email, name, role = 'admin'] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/create-user.js <email> "<Full Name>" [admin|staff|production]');
  process.exit(1);
}
const password = crypto.randomBytes(9).toString('base64url');
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?').run(hashPassword(password), existing.id);
  console.log(`Reset password for ${email}`);
} else {
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hashPassword(password), ['staff', 'production'].includes(role) ? role : 'admin');
  console.log(`Created ${role} ${email}`);
}
console.log(`Temporary password: ${password}`);
