# Checkout System Configuration Guide

This project supports two checkout methods:
1. **Crypto Checkout** - Original blockchain payment system (BTC, ETH, SOL)
2. **Email Invoice Checkout** - Email-based invoice system with SMTP delivery

## ⚡ Quick Configuration (Database-Driven)

### Switch Between Checkout Types

**All configuration is now managed via the Admin Panel!**

1. Log in to the admin panel at `/admin`
2. Navigate to **Settings** (`/admin/settings`)
3. Toggle between **Email Invoice** or **Cryptocurrency** checkout
4. Add or remove admin email addresses
5. Changes take effect immediately!

The system will automatically:
- Route cart to the correct checkout page
- Show appropriate payment badge (📧 Invoice or ₿ Bitcoin)
- Use the correct API endpoint
- Display relevant UI elements
- Send notifications to all configured admin emails

---

## Email Checkout Configuration

### 1. Admin Email Settings (Admin Panel)

**Configure via Admin Panel:** `/admin/settings`

- Add multiple admin email addresses
- All admins receive order notifications
- Real-time email validation
- Add/remove emails instantly

**Legacy Method (Deprecated):**
The old `data/email-config.js` file is kept for backwards compatibility but is no longer used.
All settings are now stored in the database (`site_settings` table).

### 2. SMTP Settings (Using Nodemailer)

The system uses **Nodemailer** with SMTP to send emails directly (no API required).

Edit **`.env.local`**:

```bash
# SMTP Configuration (ProtonMail)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_USER=noreply@aminocan.com
SMTP_PASSWORD=YZQ2CN93WNCTU7N1
SMTP_FROM_NAME=Aminocan
SMTP_FROM_EMAIL=noreply@aminocan.com
```

**ProtonMail SMTP Settings:**
- Host: `smtp.protonmail.ch`
- Port: `587` (STARTTLS)
- Security: TLS/STARTTLS (not SSL)
- Authentication: Username and password

**Alternative SMTP Providers:**
- **Gmail:** `smtp.gmail.com:587` (requires App Password with 2FA)
- **Outlook:** `smtp-mail.outlook.com:587`
- **SendGrid:** `smtp.sendgrid.net:587`
- **Mailgun:** `smtp.mailgun.org:587`
- **AWS SES:** Your region endpoint, port 587

---

## How It Works

### Crypto Checkout (`CHECKOUT_TYPE = 'crypto'`)
- **Route:** `/checkout`
- **Process:**
  1. Customer fills shipping info
  2. Selects crypto (BTC/ETH/SOL)
  3. Gets unique payment address
  4. Sends crypto payment
  5. System monitors blockchain
  6. Order confirmed after confirmations

### Email Checkout (`CHECKOUT_TYPE = 'email'`)
- **Route:** `/checkout-email`
- **Process:**
  1. Customer fills shipping info
  2. Submits order (no payment selection)
  3. System sends invoice to customer email
  4. System notifies admin via email
  5. Admin processes payment manually
  6. Admin updates order status

---

## Email Templates

Both customer and admin emails feature:
- Professional design matching site aesthetics
- Bronze accent colors
- Order details with line items
- Shipping address
- Referral code (if applied)
- Total with breakdown

### Customer Invoice Email
- Clean, branded invoice layout
- Payment instructions
- Order number prominently displayed
- Professional typography

### Admin Notification Email
- Immediate order alert
- Complete customer information
- Full order breakdown
- Link to admin dashboard

---

## File Structure

### Email Checkout Files
```
app/
  checkout-email/
    page.tsx              # Email checkout page
  api/
    orders-email/
      route.ts            # Email order API endpoint

data/
  email-config.js         # Configuration file

lib/
  email.ts               # Email templates (added functions)
```

### Configuration Files
```
.env.local              # SMTP credentials
data/email-config.js    # Admin email & checkout type
```

---

## Testing

### Test Email Checkout
1. Set `CHECKOUT_TYPE = 'email'` in `data/email-config.js`
2. Add items to cart
3. Click "Proceed to Checkout"
4. Fill in shipping info
5. Submit order
6. Check customer email for invoice
7. Check admin email for notification

### Test Crypto Checkout
1. Set `CHECKOUT_TYPE = 'crypto'` in `data/email-config.js`
2. Follow original crypto checkout flow

---

## Important Notes

### Security
- SMTP credentials in `.env.local` are **not** committed to git
- Keep `.env.local` secure and never share publicly
- Admin email receives all order notifications

### Order Status
- Email orders: `pending_invoice`
- Crypto orders: `pending` → `confirmed`

### Compatibility
- Both systems use same cart logic
- Shipping validation identical
- Referral codes work in both
- Order tracking compatible with both

---

## Troubleshooting

### Emails Not Sending
1. Verify SMTP credentials in `.env.local`
2. Check SMTP host and port
3. Ensure email provider allows SMTP access
4. Check server logs for errors

### Wrong Checkout Loading
1. Verify `CHECKOUT_TYPE` in `data/email-config.js`
2. Restart development server after changes
3. Clear browser cache

### Hydration Errors
- Cart component uses `mounted` state to prevent SSR mismatches
- This is normal and handled automatically

---

## Support

For questions or issues:
- Check console logs for errors
- Verify all configuration files
- Ensure `.env.local` is properly set up
- Test email sending separately if needed
