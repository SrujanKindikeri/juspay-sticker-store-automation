/**
 * Gmail OTP Service for PayPilot
 * Interacts with Gmail via authenticated SSL IMAP helper (scripts/gmail_otp_retriever.py).
 * Encapsulates secure retrieval, masking, timeout handling, and OTP retry state machine.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Helper to mask OTP for logging (Never display plaintext OTP)
export function maskOtp(otp) {
  if (!otp || typeof otp !== 'string') return '******';
  return `${otp.slice(0, 2)}****`;
}

/**
 * Executes python retriever to fetch the latest OTP email.
 */
export async function fetchLatestGmailOtp({
  recipient = 'lifeflow4u.support@gmail.com',
  minTimestamp = null,
  excludeIds = [],
  excludeOtps = [],
  timeoutSeconds = 90,
  pollInterval = 3,
} = {}) {
  const pythonPath = path.resolve(process.cwd(), 'backend', 'venv', 'Scripts', 'python.exe');
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'gmail_otp_retriever.py');

  const args = [
    scriptPath,
    '--recipient', recipient,
    '--timeout', timeoutSeconds.toString(),
    '--interval', pollInterval.toString(),
  ];

  if (minTimestamp) {
    args.push('--min-timestamp', minTimestamp.toString());
  }
  if (excludeIds.length > 0) {
    args.push('--exclude-ids', ...excludeIds);
  }
  if (excludeOtps.length > 0) {
    args.push('--exclude-otps', ...excludeOtps);
  }

  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, args, {
      timeout: (timeoutSeconds + 15) * 1000,
      encoding: 'utf8',
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error(stderr || 'No response from Gmail OTP retriever script');
    }

    // Parse the last JSON line
    const lines = trimmed.split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const data = JSON.parse(lastLine);

    return data;
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Error executing Gmail OTP retriever',
    };
  }
}
