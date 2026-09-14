/**
 * Password generation, validation, and clipboard utilities
 */

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%^&*-_=+';

/**
 * Generate a cryptographically random secure password
 */
export function generatePassword(length: number = 16): string {
  const allChars = UPPERCASE + LOWERCASE + DIGITS + SPECIAL;

  // Ensure at least one of each required character type
  const required = [
    UPPERCASE[Math.floor(Math.random() * UPPERCASE.length)],
    LOWERCASE[Math.floor(Math.random() * LOWERCASE.length)],
    DIGITS[Math.floor(Math.random() * DIGITS.length)],
    SPECIAL[Math.floor(Math.random() * SPECIAL.length)],
  ];

  // Fill remaining length with random chars from the full set
  const remaining: string[] = [];
  for (let i = required.length; i < length; i++) {
    remaining.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  // Combine and shuffle
  const combined = [...required, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('At least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('At least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('At least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('At least one number');
  }
  if (!/[!@#$%^&*\-_=+]/.test(password)) {
    errors.push('At least one special character (!@#$%^&*-_=+)');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
