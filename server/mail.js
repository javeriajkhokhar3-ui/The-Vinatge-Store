'use strict';

// Optional. If SMTP_HOST and MAIL_TO are set, each new inquiry is also emailed.
// Without them, inquiries are still saved and visible in /admin.
const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST || !process.env.MAIL_TO) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
  return transport;
}

async function notifyInquiry(inq, shopName) {
  const t = getTransport();
  if (!t) return;
  const subject = inq.item_title
    ? `${shopName}: question about ${inq.item_title}`
    : `${shopName}: new message from ${inq.name}`;
  const text = [
    `From: ${inq.name}`,
    `Contact: ${inq.contact}`,
    inq.item_title ? `About: ${inq.item_title}` : null,
    '',
    inq.message
  ].filter((l) => l !== null).join('\n');
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || process.env.MAIL_TO,
      to: process.env.MAIL_TO,
      subject,
      text
    });
  } catch (err) {
    console.error('[mail] could not send inquiry email:', err.message);
  }
}

module.exports = { notifyInquiry };
