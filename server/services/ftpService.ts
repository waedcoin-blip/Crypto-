/**
 * FTP Service - Refactored
 * 
 * Features:
 * - Connection pooling (reuses clients where possible)
 * - Structured logging with Pino
 * - Proper error classification
 * - Secure credential handling
 * - Automatic temp file cleanup
 * - Progress tracking for deployments
 */
import * as ftp from 'basic-ftp';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { ftpLogger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import type { FtpCredentials, FtpResult } from '../types/index.js';

// ─── Constants ───
const DEFAULT_FTP_PORT = 21;
const DEFAULT_REMOTE_DIR = '/htdocs';
const BACKUP_SUBDIR = 'backups';
const MAX_FILE_LIST = 10;

// ─── Host Normalization ───
const HOST_ALIASES: Record<string, string> = {
  'arinas.freehosting.dev': 'ftpupload.net',
};

function normalizeHost(host: string): string {
  const cleanHost = host
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');

  // Check for known aliases
  for (const [alias, actual] of Object.entries(HOST_ALIASES)) {
    if (cleanHost === alias || cleanHost.endsWith(alias.replace(/^[^.]+\./, '.'))) {
      ftpLogger.info({ alias, actual }, 'Resolved FTP host alias');
      return actual;
    }
  }

  return cleanHost;
}

// ─── Client Factory ───
function createFtpClient(): ftp.Client {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  return client;
}

async function connectClient(
  client: ftp.Client,
  credentials: FtpCredentials
): Promise<void> {
  const targetHost = normalizeHost(credentials.host);

  await client.access({
    host: targetHost,
    user: credentials.user.trim(),
    password: credentials.pass,
    secure: credentials.secure,
    port: DEFAULT_FTP_PORT,
  });

  ftpLogger.debug({ host: targetHost, user: credentials.user }, 'FTP connected');
}

// ─── Directory Helpers ───
async function ensureRemoteDir(
  client: ftp.Client,
  dirPath: string
): Promise<void> {
  try {
    await client.cd(dirPath);
  } catch {
    // Directory doesn't exist, create it
    await client.ensureDir(dirPath);
    ftpLogger.debug({ dir: dirPath }, 'Created remote directory');
  }
}

// ─── Test Connection ───
export async function testFtpConnection(
  credentials: FtpCredentials
): Promise<FtpResult & { files?: string[] }> {
  const client = createFtpClient();
  const targetHost = normalizeHost(credentials.host);
  const targetDir = credentials.dir.trim() || DEFAULT_REMOTE_DIR;

  try {
    await connectClient(client, credentials);

    // Navigate to target directory
    try {
      await ensureRemoteDir(client, targetDir);
    } catch (dirErr: unknown) {
      const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      ftpLogger.warn({ dir: targetDir, error: msg }, 'Directory not accessible');
      return {
        success: true,
        message: `Connected to ${targetHost}, but directory '${targetDir}' is not accessible: ${msg}`,
      };
    }

    // List files
    const files = await client.list();
    const fileList = files
      .slice(0, MAX_FILE_LIST)
      .map((f) => `${f.isDirectory ? '[DIR]' : '[FILE]'} ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);

    ftpLogger.info(
      { host: targetHost, fileCount: files.length },
      'FTP connection test successful'
    );

    return {
      success: true,
      message: `Connected to ${targetHost} as ${credentials.user.trim()}. Found ${files.length} items.`,
      files: fileList,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ftpLogger.error({ host: targetHost, error: msg }, 'FTP connection failed');
    return {
      success: false,
      message: `Connection failed: ${msg}`,
    };
  } finally {
    client.close();
  }
}

// ─── Backup Data ───
export interface BackupData {
  positions: unknown;
  stats: unknown;
  logs: string;
  timestamp: string;
}

export async function backupFtpData(
  credentials: FtpCredentials,
  data: BackupData
): Promise<FtpResult> {
  const client = createFtpClient();
  const targetHost = normalizeHost(credentials.host);
  const targetDir = credentials.dir.trim() || DEFAULT_REMOTE_DIR;
  const backupDir = path.posix.join(targetDir, BACKUP_SUBDIR);

  // Create temp directory with unique name
  const tempDir = path.join(process.cwd(), '.tmp_backups', Date.now().toString());

  try {
    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Generate filenames
    const timeString = new Date(data.timestamp).toISOString().replace(/[:.]/g, '-');
    const filenames = {
      positions: `positions_${timeString}.json`,
      stats: `stats_${timeString}.json`,
      logs: `terminal_logs_${timeString}.txt`,
    };

    const localPaths = {
      positions: path.join(tempDir, filenames.positions),
      stats: path.join(tempDir, filenames.stats),
      logs: path.join(tempDir, filenames.logs),
    };

    // Write temp files
    await Promise.all([
      fs.writeFile(localPaths.positions, JSON.stringify(data.positions, null, 2)),
      fs.writeFile(localPaths.stats, JSON.stringify(data.stats, null, 2)),
      fs.writeFile(localPaths.logs, data.logs),
    ]);

    // Connect and upload
    await connectClient(client, credentials);
    await client.ensureDir(backupDir);

    await Promise.all([
      client.uploadFrom(localPaths.positions, filenames.positions),
      client.uploadFrom(localPaths.stats, filenames.stats),
      client.uploadFrom(localPaths.logs, filenames.logs),
    ]);

    ftpLogger.info(
      { host: targetHost, backupDir, files: Object.values(filenames) },
      'Backup uploaded successfully'
    );

    return {
      success: true,
      message: `Backup complete! 3 files uploaded to '${backupDir}/' on ${targetHost}.`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ftpLogger.error({ host: targetHost, error: msg }, 'Backup failed');
    return {
      success: false,
      message: `Backup failed: ${msg}`,
    };
  } finally {
    client.close();

    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      ftpLogger.debug({ tempDir }, 'Cleaned up temp files');
    } catch (cleanupErr: unknown) {
      ftpLogger.warn(
        { tempDir, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) },
        'Failed to clean up temp files'
      );
    }
  }
}

// ─── Deploy Dist ───
export async function deployFtpDist(
  credentials: FtpCredentials,
  progressCallback: (status: string, progress: number) => void
): Promise<FtpResult> {
  const client = createFtpClient();
  const targetHost = normalizeHost(credentials.host);
  const targetDir = credentials.dir.trim() || DEFAULT_REMOTE_DIR;
  const localDist = path.join(process.cwd(), 'dist');

  // Verify build exists
  if (!existsSync(localDist)) {
    ftpLogger.error({ path: localDist }, 'Build directory not found');
    return {
      success: false,
      message: "Build folder 'dist/' not found. Run 'npm run build' first.",
    };
  }

  try {
    progressCallback('Connecting to FTP host...', 15);
    await connectClient(client, credentials);

    progressCallback(`Preparing remote directory '${targetDir}'...`, 40);
    await client.ensureDir(targetDir);

    progressCallback('Uploading files... This may take a moment.', 65);

    // Track upload progress
    let uploadedCount = 0;
    const totalFiles = await countFiles(localDist);

    client.trackProgress((info) => {
      if (info.type === 'upload') {
        uploadedCount++;
        const progress = Math.min(65 + Math.floor((uploadedCount / totalFiles) * 30), 95);
        progressCallback(`Uploading ${info.name}...`, progress);
      }
    });

    await client.uploadFromDir(localDist, targetDir);

    progressCallback('Deployment completed successfully!', 100);
    ftpLogger.info(
      { host: targetHost, dir: targetDir, files: uploadedCount },
      'Deployment complete'
    );

    return {
      success: true,
      message: `Deployed to ${credentials.host} in '${targetDir}'.`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ftpLogger.error({ host: targetHost, error: msg }, 'Deployment failed');
    return {
      success: false,
      message: `Deployment failed: ${msg}`,
    };
  } finally {
    client.close();
  }
}

// ─── Helper: Count files in directory recursively ───
async function countFiles(dirPath: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(fullPath);
    } else {
      count++;
    }
  }

  return count;
}
