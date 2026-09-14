/**
 * Affiliate System Utility Functions
 * Aminocan Peptides - 10% Commission Program
 */

/**
 * Generate a unique 8-character alphanumeric referral code
 * Format: UPPERCASE letters and numbers for clarity
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar chars (I,1,O,0)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Calculate commission amount based on order total
 * @param orderTotal - The total amount of the order
 * @param commissionRate - The commission rate (default 10%)
 * @returns The commission amount
 */
export function calculateCommission(orderTotal: number, commissionRate: number = 10): number {
  return Number((orderTotal * (commissionRate / 100)).toFixed(2));
}

/**
 * Validate referral code format
 * @param code - The referral code to validate
 * @returns true if valid format
 */
export function isValidReferralCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

/**
 * Hash password using Web Crypto API (browser-compatible)
 * For production, consider using bcrypt on the server side
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format wallet address for display (truncated)
 */
export function formatWalletAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Ethereum wallet address format
 */
export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
