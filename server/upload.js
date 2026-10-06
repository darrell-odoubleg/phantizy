// upload.js — shared multer setup for offer documents and festival
// welcome-package files. Files land in UPLOAD_DIR/<subdir> with random names;
// the original name lives in the database.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../db/init');

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.heic', '.txt', '.rtf', '.pages']);

// subdirFor(req) → folder under UPLOAD_DIR, e.g. '12' or 'festivals/3'
function makeUpload(subdirFor) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(UPLOAD_DIR, subdirFor(req));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase());
      },
    }),
    limits: { fileSize: 30 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => {
      const ok = ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : Object.assign(new Error('That file type is not allowed (PDF, Word, Excel, images, text)'), { status: 400 }), ok);
    },
  });
}

// Serves a stored file: PDFs and PNG/JPEG inline with ?view=1, everything else as a download.
function sendStoredFile(req, res, filePath, mimeType, originalName) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const viewable = /^(application\/pdf|image\/(png|jpeg))$/.test(mimeType || '');
  if (req.query.view === '1' && viewable) {
    res.type(mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
    return res.sendFile(filePath);
  }
  res.download(filePath, originalName);
}

module.exports = { makeUpload, sendStoredFile, UPLOAD_DIR };
