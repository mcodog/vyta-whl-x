/**
 * Email Checkout Configuration
 *
 * ⚠️ DEPRECATED - This file is kept for backwards compatibility only
 *
 * Configuration has been moved to the database and can be managed via:
 * Admin Panel → Settings → /admin/settings
 *
 * The system now dynamically fetches settings from the database.
 * Changes made to this file will NOT affect the application.
 *
 * To configure:
 * 1. Log in to the admin panel
 * 2. Navigate to Settings
 * 3. Update checkout type and admin email addresses
 */

// ⚠️ DEPRECATED - Use admin panel settings instead
export const ADMIN_EMAIL = "codogmjo@gmail.com";

// ⚠️ DEPRECATED - Use admin panel settings instead
export const CHECKOUT_TYPE = "email";

// Email sender configuration (from .env)
export const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || "smtp.protonmail.ch",
  port: parseInt(process.env.SMTP_PORT || "587"),
  user: process.env.SMTP_USER || "noreply@aminocan.com",
  password: process.env.SMTP_PASSWORD,
  fromName: process.env.SMTP_FROM_NAME || "PuraMass",
  fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@aminocan.com",
};
