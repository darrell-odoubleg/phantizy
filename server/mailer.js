// mailer.js
// Outgoing email over SMTP (port 587 + STARTTLS; 465 is blocked on this VPS).
// Settings live in .env: SMTP_HOST / SMTP_USER / SMTP_PASS — currently the
// info@phantizyproductions.com mailbox on mail.phantizyproductions.com.
// Until SMTP_PASS is set, isConfigured() is false and the UI offers the PDF
// download only.

const nodemailer = require('nodemailer');

function settings() {
  return {
    host: process.env.SMTP_HOST || 'mail.phantizyproductions.com',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.COMPANY_NAME || 'Phantizy Productions',
  };
}

function isConfigured() {
  const s = settings();
  return !!(s.user && s.pass);
}

let transport = null;
function getTransport() {
  if (!transport) {
    const s = settings();
    transport = nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.port === 465, requireTLS: s.port === 587,
      auth: { user: s.user, pass: s.pass },
      disableFileAccess: true, disableUrlAccess: true,
    });
  }
  return transport;
}

// attachments: [{ filename, content: Buffer, contentType }]
async function sendMail({ to, cc, replyTo, subject, text, attachments }) {
  if (!isConfigured()) throw Object.assign(new Error('Email is not set up yet (SMTP_PASS missing in .env)'), { status: 503 });
  const s = settings();
  return getTransport().sendMail({
    from: { name: s.fromName, address: s.user },
    to, cc: cc || undefined, replyTo: replyTo || undefined,
    subject, text, attachments,
  });
}

module.exports = { isConfigured, sendMail, fromAddress: () => settings().user };
