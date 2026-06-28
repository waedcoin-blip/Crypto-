import * as ftp from "basic-ftp";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";

export interface FtpConfig {
  host: string;
  user: string;
  pass: string;
  dir: string;
  secure?: boolean;
}

/**
 * Normalizes host if user has inputted the website domain (arinas.freehosting.dev)
 * instead of the actual FTP host (ftpupload.net).
 */
function getActualFtpHost(host: string): string {
  const cleanHost = host.trim().replace(/^(https?:\/\/)?(www\.)?/, "");
  if (cleanHost === "arinas.freehosting.dev" || cleanHost.includes("freehosting.dev")) {
    // For freehosting.dev (InfinityFree), the FTP host is ftpupload.net
    return "ftpupload.net";
  }
  return cleanHost;
}

/**
 * Tests FTP Connection
 */
export async function testFtpConnection(config: FtpConfig): Promise<{ success: boolean; message: string; files?: string[] }> {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  
  const targetHost = getActualFtpHost(config.host);
  const targetDir = config.dir.trim() || "/htdocs";

  try {
    await client.access({
      host: targetHost,
      user: config.user.trim(),
      password: config.pass,
      secure: config.secure ?? false,
      port: 21
    });

    // Verify remote directory exists or navigate to it
    try {
      await client.cd(targetDir);
    } catch (dirErr: any) {
      // Directory may not exist yet, try to create or go to root
      try {
        await client.ensureDir(targetDir);
      } catch (ensureErr: any) {
        return {
          success: true,
          message: `Connected successfully to FTPServer, but directory '${targetDir}' wasn't accessible: ${dirErr.message || dirErr}`
        };
      }
    }

    const files = await client.list();
    const fileList = files.map(f => `${f.isDirectory ? '📁' : '📄'} ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);

    return {
      success: true,
      message: `Successfully connected to ${targetHost} ! Logged in as ${config.user.trim()}.`,
      files: fileList.slice(0, 10) // Return first 10 files as proof of list success
    };
  } catch (error: any) {
    console.error("[FTP CONNECTION ERROR]:", error);
    return {
      success: false,
      message: error.message || String(error)
    };
  } finally {
    client.close();
  }
}

/**
 * Backend data backup to FTP
 */
export async function backupFtpData(
  config: FtpConfig,
  data: { positions: any; stats: any; logs: string; timestamp: string }
): Promise<{ success: boolean; message: string }> {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  const targetHost = getActualFtpHost(config.host);
  const targetDir = config.dir.trim() || "/htdocs";
  const backupFolder = path.join(targetDir, "backups");

  const tempDir = path.join(process.cwd(), "tmp_backups");

  try {
    // Create local temp dir
    await fs.mkdir(tempDir, { recursive: true });

    const timeString = new Date(data.timestamp).toISOString().replace(/[:.]/g, "-");
    const localPositionsPath = path.join(tempDir, `positions_${timeString}.json`);
    const localStatsPath = path.join(tempDir, `stats_${timeString}.json`);
    const localLogsPath = path.join(tempDir, `terminal_logs_${timeString}.txt`);

    // Write temp files locally
    await fs.writeFile(localPositionsPath, JSON.stringify(data.positions, null, 2));
    await fs.writeFile(localStatsPath, JSON.stringify(data.stats, null, 2));
    await fs.writeFile(localLogsPath, data.logs);

    // Access FTP
    await client.access({
      host: targetHost,
      user: config.user.trim(),
      password: config.pass,
      secure: config.secure ?? false,
      port: 21
    });

    // Ensure backups directory exists remote
    await client.ensureDir(backupFolder);

    // Upload files
    await client.uploadFrom(localPositionsPath, `positions_${timeString}.json`);
    await client.uploadFrom(localStatsPath, `stats_${timeString}.json`);
    await client.uploadFrom(localLogsPath, `terminal_logs_${timeString}.txt`);

    // Clean up local temp files
    try {
      await fs.rm(localPositionsPath, { force: true });
      await fs.rm(localStatsPath, { force: true });
      await fs.rm(localLogsPath, { force: true });
    } catch (e) {}

    return {
      success: true,
      message: `System snapshot back up completed! Successfully uploaded positions, trade metrics, and terminal session logs to '${backupFolder}/' on ${targetHost}.`
    };
  } catch (error: any) {
    console.error("[FTP BACKUP ERROR]:", error);
    return {
      success: false,
      message: `Backup failed: ${error.message || String(error)}`
    };
  } finally {
    client.close();
  }
}

/**
 * Performs recursive upload of dist directory to the remote directory (defaults to /htdocs)
 */
export async function deployFtpDist(
  config: FtpConfig,
  progressCallback: (status: string, progress: number) => void
): Promise<{ success: boolean; message: string }> {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  const targetHost = getActualFtpHost(config.host);
  const targetDir = config.dir.trim() || "/htdocs";
  const localDist = path.join(process.cwd(), "dist");

  // Check if build exists
  if (!existsSync(localDist)) {
    return {
      success: false,
      message: "Vite production build folder ('dist/') does not exist. Please trigger compiling first."
    };
  }

  try {
    progressCallback("Connecting to FTP host...", 15);
    await client.access({
      host: targetHost,
      user: config.user.trim(),
      password: config.pass,
      secure: config.secure ?? false,
      port: 21
    });

    progressCallback(`Verifying remote target directory '${targetDir}'...`, 40);
    await client.ensureDir(targetDir);

    progressCallback("Syncing files recursively... This may take a moment...", 65);
    
    // basic-ftp handles directories, creating folders, overwriting files automatically
    await client.uploadFromDir(localDist, targetDir);

    progressCallback("Deployment completed successfully!", 100);
    return {
      success: true,
      message: `Deployment complete! Compiled web app is now hosted on '${config.host}' in directory '${targetDir}'.`
    };
  } catch (error: any) {
    console.error("[FTP DEPLOY ERROR]:", error);
    return {
      success: false,
      message: `FTP transmission failed: ${error.message || String(error)}`
    };
  } finally {
    client.close();
  }
}
