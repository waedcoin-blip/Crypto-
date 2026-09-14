// server/routes/ftp.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Protect all /api/hosting routes
router.use(requireAuth);

// Configure multer for secure file uploads
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.json']);
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/json']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('INVALID_FILE_EXTENSION: Only .png, .jpg, .jpeg, .webp, and .json files are allowed'), '');
    }
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
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
      const sanitized = path.basename(filename);
      const filePath = path.resolve(UPLOAD_DIR, sanitized);
      if (!filePath.startsWith(UPLOAD_DIR)) return null;
      const stats = fs.statSync(filePath);
      return {
        filename: sanitized,
        size: stats.size,
        uploadedAt: stats.birthtime.toISOString(),
      };
    }).filter(Boolean);

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
  const filePath = path.resolve(UPLOAD_DIR, sanitized);

  if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ status: 'error', error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ status: 'success', message: `File '${sanitized}' deleted`, timestamp: Date.now() });
}));

export default router;

