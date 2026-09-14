import nodemailer from 'nodemailer';

// These helpers historically sent through the Resend SDK, which was not
// delivering in production. We now send over the same SMTP transport that the
// admin invoice email uses (the one confirmed working). To avoid rewriting
// every template below, `getResend()` returns a thin shim that mirrors the
// `resend.emails.send(...)` call shape but routes through nodemailer.
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.protonmail.ch',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

/** A file attached to an outgoing email (mirrors nodemailer's attachment shape). */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function getResend() {
  return {
    emails: {
      async send(opts: {
        from: string;
        to: string | string[];
        subject: string;
        html: string;
        attachments?: EmailAttachment[];
      }): Promise<{ data: { id: string | null } | null; error: { message: string } | null }> {
        try {
          const info = await getTransporter().sendMail({
            from: opts.from,
            to: opts.to,
            subject: opts.subject,
            html: opts.html,
            attachments: opts.attachments,
          });
          return { data: { id: info.messageId ?? null }, error: null };
        } catch (e) {
          return {
            data: null,
            error: { message: e instanceof Error ? e.message : 'Send failed' },
          };
        }
      },
    },
  };
}

// Prefer the SMTP sender (matches the working invoice email path); fall back to
// EMAIL_FROM for backwards compatibility.
const fromEmail =
  (process.env.SMTP_FROM_EMAIL
    ? `${process.env.SMTP_FROM_NAME || 'PuraMass'} <${process.env.SMTP_FROM_EMAIL}>`
    : process.env.EMAIL_FROM) || 'PuraMass <orders@aminocan.com>';

/**
 * Generic HTML email sender over the shared SMTP transport. Use for one-off
 * transactional/notification emails (e.g. the scheduled Stock Report) that
 * don't have a dedicated template helper below.
 */
export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ success: boolean; id?: string | null; error?: string }> {
  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
    if (error) {
      console.error('sendEmail error:', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: result?.id };
  } catch (error) {
    console.error('sendEmail threw:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send email' };
  }
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  strength?: string;
}

/**
 * Send order confirmation email to customer
 */
export async function sendOrderConfirmation(data: {
  to: string;
  customerName: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  currency?: string;
}) {
  const { to, customerName, orderNumber, items, subtotal, shipping, total, currency = 'CAD' } = data;

  const itemRows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #1A1A1A;">${item.name}${item.strength ? ` - ${item.strength}` : ''}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #6B7280; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #1A1A1A; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
      </div>

      <div style="padding: 32px 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Order Confirmed</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          Hi ${customerName}, thank you for your order!
        </p>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Order Number</p>
          <p style="font-size: 16px; font-weight: 600; color: #1A1A1A; margin: 0; font-family: monospace;">${orderNumber}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px 0; border-bottom: 2px solid #E5E7EB; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Item</th>
              <th style="text-align: center; padding: 8px 0; border-bottom: 2px solid #E5E7EB; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
              <th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #E5E7EB; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div style="border-top: 1px solid #E5E7EB; padding-top: 16px;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 4px 0;">Subtotal</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 4px 0;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 4px 0;">Shipping</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 4px 0;">$${shipping.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 16px; font-weight: 700; color: #1A1A1A; padding: 12px 0 0; border-top: 2px solid #1A1A1A;">Total</td>
              <td style="font-size: 16px; font-weight: 700; color: #1A1A1A; text-align: right; padding: 12px 0 0; border-top: 2px solid #1A1A1A;">$${total.toFixed(2)} ${currency}</td>
            </tr>
          </table>
        </div>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          PuraMass Peptides &bull; Canada<br/>
          Questions? Reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: `Order Confirmed - ${orderNumber}`,
      html,
    });

    if (error) {
      console.error('Error sending order confirmation:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending order confirmation:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send shipping notification with tracking
 */
export async function sendShippingNotification(data: {
  to: string;
  customerName: string;
  orderNumber: string;
  trackingNumber: string;
}) {
  const { to, customerName, orderNumber, trackingNumber } = data;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
      </div>

      <div style="padding: 32px 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Your Order Has Shipped!</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          Hi ${customerName}, great news! Your order is on its way.
        </p>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Order Number</p>
          <p style="font-size: 16px; font-weight: 600; color: #1A1A1A; margin: 0; font-family: monospace;">${orderNumber}</p>
        </div>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Tracking Number</p>
          <p style="font-size: 16px; font-weight: 600; color: #1A1A1A; margin: 0; font-family: monospace;">${trackingNumber}</p>
        </div>

        <p style="font-size: 14px; color: #6B7280; margin: 0;">
          You can track your package using the tracking number above with your carrier's website.
        </p>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          PuraMass Peptides &bull; Canada<br/>
          Questions? Reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: `Your Order Has Shipped - ${orderNumber}`,
      html,
    });

    if (error) {
      console.error('Error sending shipping notification:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending shipping notification:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send welcome email to new customer
 */
export async function sendCustomerWelcome(data: {
  to: string;
  customerName: string;
}) {
  const { to, customerName } = data;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
      </div>

      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Welcome to PuraMass!</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          Hi ${customerName}, thanks for creating an account. You're all set to start shopping for premium Canadian peptides.
        </p>
        <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com'}/products" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          Browse Products
        </a>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          PuraMass Peptides &bull; Canada<br/>
          Questions? Reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: 'Welcome to PuraMass!',
      html,
    });

    if (error) {
      console.error('Error sending welcome email:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send welcome email to new affiliate
 */
export async function sendAffiliateWelcome(data: {
  to: string;
  affiliateName: string;
  referralCode: string;
}) {
  const { to, affiliateName, referralCode } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Affiliate Program</p>
      </div>

      <div style="padding: 32px 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Welcome to the Affiliate Program!</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          Hi ${affiliateName}, your affiliate account is ready. Start sharing your referral code and earn 10% commission on every sale.
        </p>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: center;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">Your Referral Code</p>
          <p style="font-size: 28px; font-weight: 700; color: #1A1A1A; margin: 0; font-family: monospace; letter-spacing: 0.1em;">${referralCode}</p>
        </div>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Your Referral URL</p>
          <p style="font-size: 13px; color: #1A1A1A; margin: 0; font-family: monospace; word-break: break-all;">${baseUrl}?ref=${referralCode}</p>
        </div>

        <div style="text-align: center;">
          <a href="${baseUrl}/affiliate/dashboard" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Go to Dashboard
          </a>
        </div>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          PuraMass Peptides &bull; Canada<br/>
          Questions? Reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: 'Welcome to the PuraMass Affiliate Program!',
      html,
    });

    if (error) {
      console.error('Error sending affiliate welcome:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending affiliate welcome:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send payment confirmed notification
 */
export async function sendPaymentConfirmed(data: {
  to: string;
  orderNumber: string;
}) {
  const { to, orderNumber } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <div style="width: 48px; height: 48px; background: #ECFDF5; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 24px;">&#10003;</span>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Payment Confirmed!</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          Your payment for order <strong>${orderNumber}</strong> has been received and confirmed on the blockchain.
        </p>
        <div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px;">Your order is now being processed and will ship within 24-48 hours.</p>
        </div>
        <a href="${baseUrl}/account/dashboard" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          View Your Order
        </a>
      </div>
      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">PuraMass Peptides &bull; Canada<br/>Questions? Reply to this email.</p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: `Payment Confirmed - ${orderNumber}`,
      html,
    });

    if (error) {
      console.error('Error sending payment confirmed:', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending payment confirmed:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send admin notification when payment is confirmed
 */
export async function sendAdminPaymentNotification(data: {
  orderNumber: string;
  total: number;
  crypto: string;
  paymentAmount: string;
  customerEmail?: string;
  items: Array<{ name: string; quantity: number }>;
  /** Recipient(s); defaults to the primary admin inbox. */
  to?: string | string[];
}) {
  const { orderNumber, total, crypto, paymentAmount, customerEmail, items } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const itemList = items
    .map(i => `<li style="font-size: 14px; color: #1A1A1A; padding: 4px 0;">${i.name} x${i.quantity}</li>`)
    .join('');

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Admin Notification</p>
      </div>

      <div style="padding: 32px 24px;">
        <div style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <h2 style="font-size: 18px; font-weight: 600; color: #065F46; margin: 0;">Payment Received!</h2>
        </div>

        <div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Order</td>
              <td style="font-size: 14px; font-weight: 600; color: #1A1A1A; padding: 6px 0; text-align: right; font-family: monospace;">${orderNumber}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Total (CAD)</td>
              <td style="font-size: 14px; font-weight: 600; color: #1A1A1A; padding: 6px 0; text-align: right;">$${total.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Paid</td>
              <td style="font-size: 14px; font-weight: 600; color: #1A1A1A; padding: 6px 0; text-align: right;">${paymentAmount} ${crypto.toUpperCase()}</td>
            </tr>
            ${customerEmail ? `<tr>
              <td style="font-size: 12px; color: #6B7280; padding: 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Customer</td>
              <td style="font-size: 14px; color: #1A1A1A; padding: 6px 0; text-align: right;">${customerEmail}</td>
            </tr>` : ''}
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">Items</p>
          <ul style="margin: 0; padding: 0 0 0 20px;">${itemList}</ul>
        </div>

        <div style="text-align: center;">
          <a href="${baseUrl}/admin/orders" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            View in Admin
          </a>
        </div>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to: data.to ?? 'info@aminocan.com',
      subject: `Payment Received - ${orderNumber} - $${total.toFixed(2)} CAD`,
      html,
    });

    if (error) {
      console.error('Error sending admin notification:', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send invoice email to customer (for email checkout)
 */
export async function sendCustomerInvoice(data: {
  to: string;
  customerName: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  shippingAddress: {
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  referralCode?: string;
  currency?: string;
}) {
  const { to, customerName, orderNumber, items, subtotal, shipping, total, shippingAddress, referralCode, currency = 'CAD' } = data;

  const itemRows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #1A1A1A;">
            ${item.name}${item.strength ? ` - ${item.strength}` : ''}
          </td>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #6B7280; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #1A1A1A; text-align: right;">$${item.price.toFixed(2)}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; color: #1A1A1A; text-align: right; font-weight: 600;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="max-width: 650px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 40px 32px; text-align: center; border-bottom: 2px solid #1A1A1A; background: linear-gradient(to bottom, #FFFFFF, #F7F7F7);">
        <h1 style="font-size: 28px; font-weight: 700; color: #1A1A1A; margin: 0 0 4px; letter-spacing: -0.02em;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 0; text-transform: uppercase; font-weight: 600;">Canadian Peptides</p>
      </div>

      <!-- Invoice Title -->
      <div style="padding: 32px 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h2 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0 0 8px;">INVOICE</h2>
          <p style="font-size: 14px; color: #6B7280; margin: 0;">
            Thank you for your order, ${customerName}
          </p>
        </div>

        <!-- Order Number Badge -->
        <div style="background: linear-gradient(135deg, #9C8B5A 0%, #B8A675 100%); border-radius: 12px; padding: 20px; margin-bottom: 32px; text-align: center;">
          <p style="font-size: 11px; color: rgba(255,255,255,0.8); margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Order Number</p>
          <p style="font-size: 20px; font-weight: 700; color: #FFFFFF; margin: 0; font-family: monospace; letter-spacing: 0.05em;">${orderNumber}</p>
        </div>

        <!-- Shipping Address -->
        <div style="background: #F7F7F7; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #E5E7EB;">
          <p style="font-size: 11px; color: #9C8B5A; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Ship To</p>
          <p style="font-size: 14px; color: #1A1A1A; margin: 0; line-height: 1.6;">
            <strong>${customerName}</strong><br/>
            ${shippingAddress.address}<br/>
            ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postalCode}<br/>
            ${shippingAddress.country}
          </p>
        </div>

        ${referralCode ? `
        <!-- Referral Code -->
        <div style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <p style="font-size: 11px; color: #065F46; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Referral Code Applied</p>
          <p style="font-size: 16px; font-weight: 700; color: #065F46; margin: 0; font-family: monospace;">${referralCode}</p>
        </div>
        ` : ''}

        <!-- Items Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #FFFFFF; border-radius: 12px; overflow: hidden; border: 1px solid #E5E7EB;">
          <thead>
            <tr style="background: #1A1A1A;">
              <th style="text-align: left; padding: 14px 16px; font-size: 11px; color: #FFFFFF; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Item</th>
              <th style="text-align: center; padding: 14px 16px; font-size: 11px; color: #FFFFFF; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Qty</th>
              <th style="text-align: right; padding: 14px 16px; font-size: 11px; color: #FFFFFF; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Price</th>
              <th style="text-align: right; padding: 14px 16px; font-size: 11px; color: #FFFFFF; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <!-- Totals -->
        <div style="background: #F7F7F7; border-radius: 12px; padding: 24px; border: 1px solid #E5E7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 8px 0;">Subtotal</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 8px 0; font-weight: 500;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 8px 0;">Shipping</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 8px 0; font-weight: 500;">$${shipping.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 2px solid #1A1A1A;">
              <td style="font-size: 18px; font-weight: 700; color: #1A1A1A; padding: 16px 0 0;">Total</td>
              <td style="font-size: 20px; font-weight: 700; color: #1A1A1A; text-align: right; padding: 16px 0 0;">
                $${total.toFixed(2)} <span style="font-size: 14px; color: #9C8B5A;">${currency}</span>
              </td>
            </tr>
          </table>
        </div>

        <!-- Payment Instructions -->
        <div style="background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 12px; padding: 20px; margin-top: 24px; text-align: center;">
          <p style="font-size: 12px; color: #92400E; margin: 0; line-height: 1.6;">
            <strong>Payment Instructions:</strong><br/>
            Please send payment via e-Transfer to the email address provided separately.<br/>
            Your order will be processed once payment is received.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 32px; text-align: center; background: #1A1A1A; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: rgba(255,255,255,0.6); margin: 0 0 8px;">
          PuraMass Peptides &bull; Premium Research Compounds &bull; Canada
        </p>
        <p style="font-size: 11px; color: rgba(255,255,255,0.4); margin: 0;">
          Questions? Reply to this email or contact us at ${fromEmail}
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: `Invoice ${orderNumber} - PuraMass Peptides`,
      html,
    });

    if (error) {
      console.error('Error sending customer invoice:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending customer invoice:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send admin notification for new order (email checkout)
 */
export async function sendAdminInvoiceNotification(data: {
  adminEmail: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  shippingAddress: {
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  referralCode?: string;
  currency?: string;
}) {
  const { adminEmail, orderNumber, customerName, customerEmail, items, subtotal, shipping, total, shippingAddress, referralCode, currency = 'CAD' } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const itemList = items
    .map(i => `<li style="font-size: 14px; color: #1A1A1A; padding: 6px 0; border-bottom: 1px solid #E5E7EB;">
      <strong>${i.name}</strong>${i.strength ? ` - ${i.strength}` : ''} × ${i.quantity}
      <span style="float: right; color: #6B7280;">$${(i.price * i.quantity).toFixed(2)}</span>
    </li>`)
    .join('');

  const html = `
    <div style="max-width: 650px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <!-- Header -->
      <div style="padding: 32px 24px; text-align: center; border-bottom: 2px solid #9C8B5A; background: linear-gradient(to bottom, #1A1A1A, #2A2A2A);">
        <h1 style="font-size: 28px; font-weight: 700; color: #FFFFFF; margin: 0 0 4px;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 0; text-transform: uppercase; font-weight: 600;">New Order Notification</p>
      </div>

      <!-- Alert -->
      <div style="padding: 32px 24px;">
        <div style="background: linear-gradient(135deg, #9C8B5A 0%, #B8A675 100%); border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <h2 style="font-size: 20px; font-weight: 700; color: #FFFFFF; margin: 0;">New Order Received</h2>
        </div>

        <!-- Order Details -->
        <div style="background: #F7F7F7; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #E5E7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Order Number</td>
              <td style="font-size: 14px; font-weight: 700; color: #1A1A1A; padding: 8px 0; text-align: right; font-family: monospace;">${orderNumber}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Customer</td>
              <td style="font-size: 14px; font-weight: 600; color: #1A1A1A; padding: 8px 0; text-align: right;">${customerName}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Email</td>
              <td style="font-size: 14px; color: #1A1A1A; padding: 8px 0; text-align: right;">${customerEmail}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #6B7280; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total</td>
              <td style="font-size: 18px; font-weight: 700; color: #9C8B5A; padding: 8px 0; text-align: right;">$${total.toFixed(2)} ${currency}</td>
            </tr>
            ${referralCode ? `<tr>
              <td style="font-size: 12px; color: #6B7280; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Referral Code</td>
              <td style="font-size: 14px; font-weight: 700; color: #065F46; padding: 8px 0; text-align: right; font-family: monospace;">${referralCode}</td>
            </tr>` : ''}
          </table>
        </div>

        <!-- Shipping Address -->
        <div style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="font-size: 11px; color: #9C8B5A; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Shipping Address</p>
          <p style="font-size: 14px; color: #1A1A1A; margin: 0; line-height: 1.7;">
            ${shippingAddress.address}<br/>
            ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postalCode}<br/>
            ${shippingAddress.country}
          </p>
        </div>

        <!-- Order Items -->
        <div style="margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6B7280; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Order Items</p>
          <ul style="margin: 0; padding: 0; list-style: none; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px;">
            ${itemList}
          </ul>
        </div>

        <!-- Totals -->
        <div style="background: #F7F7F7; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #E5E7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 6px 0;">Subtotal</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 6px 0; font-weight: 500;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 14px; color: #6B7280; padding: 6px 0;">Shipping</td>
              <td style="font-size: 14px; color: #1A1A1A; text-align: right; padding: 6px 0; font-weight: 500;">$${shipping.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 2px solid #1A1A1A;">
              <td style="font-size: 16px; font-weight: 700; color: #1A1A1A; padding: 12px 0 0;">Total</td>
              <td style="font-size: 18px; font-weight: 700; color: #9C8B5A; text-align: right; padding: 12px 0 0;">$${total.toFixed(2)} ${currency}</td>
            </tr>
          </table>
        </div>

        <!-- Action Button -->
        <div style="text-align: center;">
          <a href="${baseUrl}/admin/orders" style="display: inline-block; padding: 14px 32px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">
            View in Admin Dashboard
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 11px; color: #9CA3AF; margin: 0;">
          This is an automated notification from PuraMass Admin System
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `New Order ${orderNumber} - $${total.toFixed(2)} ${currency}`,
      html,
    });

    if (error) {
      console.error('Error sending admin invoice notification:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Error sending admin invoice notification:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

/**
 * Send a passwordless "magic link" sign-in email to a customer.
 * The action link is generated server-side via Supabase
 * `auth.admin.generateLink` and delivered through our own (SMTP) mailer
 * so the email stays on-brand.
 */
export async function sendMagicLink(data: {
  to: string;
  customerName?: string;
  actionLink: string;
}) {
  const { to, customerName, actionLink } = data;
  const greeting = customerName ? `Hi ${customerName},` : 'Hi,';

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
      </div>

      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Sign in to your account</h2>
        <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
          ${greeting} click the button below to sign in instantly &mdash; no password needed.
        </p>

        <a href="${actionLink}" style="display: inline-block; padding: 14px 32px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          Sign In to PuraMass
        </a>

        <p style="font-size: 12px; color: #9CA3AF; margin: 24px 0 0; line-height: 1.6;">
          This link expires shortly and can only be used once.<br/>
          If you didn&apos;t request this, you can safely ignore this email.
        </p>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          PuraMass Peptides &bull; Canada<br/>
          Questions? Reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { data: result, error } = await getResend().emails.send({
      from: fromEmail,
      to,
      subject: 'Your PuraMass sign-in link',
      html,
    });

    if (error) {
      // Surface the precise SMTP error (e.g. auth failure, rejected recipient)
      // so it can be acted on instead of failing silently.
      console.error('[magic-link] SMTP rejected send', { to, from: fromEmail, error });
      return { success: false, error: error.message };
    }

    // Log the SMTP message id so delivery can be traced in the mail logs.
    console.log('[magic-link] SMTP accepted send', { to, id: result?.id });
    return { success: true, id: result?.id };
  } catch (error: any) {
    console.error('[magic-link] send threw', { to, error });
    return { success: false, error: error?.message || 'Failed to send email' };
  }
}
