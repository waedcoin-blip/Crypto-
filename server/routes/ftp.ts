// server/routes/ftp.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer for file uploads
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/json'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE: Only PNG, JPEG, WebP, and JSON files are allowed'));
    }
  },
});

/**
 * POST /api/hosting/upload
 * Upload a file (screenshot, config export, etc.)
 */
router.post('/upload', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', error: 'No file uploaded' });
  }

  res.json({
    status: 'success',
    file: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: `/uploads/${req.file.filename}`,
    },
    timestamp: Date.now(),
  });
}));

/**
 * GET /api/hosting/files
 * List uploaded files.
 */
router.get('/files', asyncHandler(async (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).map(filename => {
      const stats = fs.statSync(path.join(UPLOAD_DIR, filename));
      return {
        filename,
        size: stats.size,
        uploadedAt: stats.birthtime.toISOString(),
      };
    });

    res.json({ status: 'success', files, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message || String(err) });
  }
}));

/**
 * DELETE /api/hosting/files/:filename
 * Delete an uploaded file.
 */
router.delete('/files/:filename', asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params;

  // Prevent path traversal
  const sanitized = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, sanitized);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ status: 'error', error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ status: 'success', message: `File '${sanitized}' deleted`, timestamp: Date.now() });
}));

export default router;
