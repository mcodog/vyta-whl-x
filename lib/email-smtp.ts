import nodemailer from 'nodemailer';
import {
  BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
  renderPaymentInstructionsTemplate,
} from './paymentMethod';

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  strength?: string;
}

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.protonmail.ch',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || 'noreply@aminocan.com',
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

const fromEmail = `${process.env.SMTP_FROM_NAME || 'VYTA Biosciences'} <${process.env.SMTP_FROM_EMAIL || 'noreply@aminocan.com'}>`;

/**
 * Send invoice email to customer (for email checkout) - SMTP Version
 */
export async function sendCustomerInvoiceSMTP(data: {
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
  fulfillmentType?: 'shipping' | 'pickup';
  paymentMethod?: 'etransfer' | 'btc';
  /** Populated only once the BTC flow is live; used to fill the BTC template. */
  btcAddress?: string;
  btcAmount?: string;
  referralCode?: string;
  currency?: string;
}) {
  const { to, customerName, orderNumber, items, subtotal, shipping, total, shippingAddress, fulfillmentType = 'shipping', paymentMethod = 'etransfer', btcAddress, btcAmount, referralCode, currency = 'CAD' } = data;
  const isPickup = fulfillmentType === 'pickup';

  // Payment-instructions block, per the method the customer chose at checkout.
  // The Bitcoin one renders from the shared template, filled with the receiving
  // address configured in Settings → Crypto Payments; with no wallet configured
  // there is no address to print, so the email promises one rather than
  // printing a half-finished set of steps.
  const btcInstructions = btcAddress
    ? renderPaymentInstructionsTemplate(BTC_PAYMENT_INSTRUCTIONS_TEMPLATE, {
        order_number: orderNumber,
        amount: total.toFixed(2),
        currency,
        btc_address: btcAddress,
        btc_amount: btcAmount,
      })
        .trim()
        .replace(/\n/g, '<br/>')
    : `<strong style="color: #07203A;">Payment — Bitcoin (BTC):</strong><br/>
            Amount due: $${total.toFixed(2)} ${currency}.<br/>
            We will email you the deposit address for your payment shortly.<br/>
            Your order will be processed once payment is received.`;
  const paymentInstructions =
    paymentMethod === 'btc'
      ? btcInstructions
      : `<strong style="color: #07203A;">Payment — Interac e-Transfer:</strong><br/>
            We will send you instructions for your payment shortly.<br/>
            Your order will be processed once payment is received.`;

  const itemRows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #DCE7EB; font-size: 14px; color: #07203A;">
            ${item.name}${item.strength ? ` - ${item.strength}` : ''}
          </td>
          <td style="padding: 12px 0; border-bottom: 1px solid #DCE7EB; font-size: 14px; color: #5B7A8C; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #DCE7EB; font-size: 14px; color: #07203A; text-align: right;">$${item.price.toFixed(2)}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #DCE7EB; font-size: 14px; color: #07203A; text-align: right; font-weight: 600;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="max-width: 650px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 40px 32px; text-align: center; border-bottom: 1px solid #DCE7EB; background: #FFFFFF;">
        <h1 style="font-size: 28px; font-weight: 700; color: #07203A; margin: 0 0 4px; letter-spacing: 0.28em;">VYTA</h1>
        <p style="font-size: 10px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 6px 0 0;">BIOSCIENCES</p>
      </div>

      <!-- Invoice Title -->
      <div style="padding: 32px 32px 24px; background: #FFFFFF;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h2 style="font-size: 24px; font-weight: 700; color: #07203A; margin: 0 0 8px;">INVOICE</h2>
          <p style="font-size: 14px; color: #5B7A8C; margin: 0;">
            Thank you for your order, ${customerName}
          </p>
        </div>

        <!-- Order Number Badge -->
        <div style="background: #F7FAFB; border: 2px solid #438B9E; border-radius: 12px; padding: 20px; margin-bottom: 32px; text-align: center;">
          <p style="font-size: 11px; color: #5B7A8C; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Order Number</p>
          <p style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0; font-family: monospace; letter-spacing: 0.05em;">${orderNumber}</p>
        </div>

        <!-- Fulfillment Address -->
        <div style="background: #F7FAFB; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #DCE7EB;">
          <p style="font-size: 11px; color: #438B9E; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">${isPickup ? 'Pickup Location' : 'Ship To'}</p>
          <p style="font-size: 14px; color: #07203A; margin: 0; line-height: 1.6;">
            ${isPickup ? '' : `<strong>${customerName}</strong><br/>`}
            ${shippingAddress.address}<br/>
            ${[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode].filter(Boolean).join(', ')}${[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode].filter(Boolean).length ? '<br/>' : ''}
            ${shippingAddress.country === 'CA' ? 'Canada' : shippingAddress.country}
          </p>
          ${isPickup ? '<p style="font-size: 12px; color: #5B7A8C; margin: 12px 0 0;">We\'ll contact you to arrange a pickup time once payment is received.</p>' : ''}
        </div>

        ${referralCode ? `
        <!-- Referral Code -->
        <div style="background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <p style="font-size: 11px; color: #15803D; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Referral Code Applied</p>
          <p style="font-size: 16px; font-weight: 700; color: #15803D; margin: 0; font-family: monospace;">${referralCode}</p>
        </div>
        ` : ''}

        <!-- Items Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #FFFFFF; border-radius: 12px; overflow: hidden; border: 1px solid #DCE7EB;">
          <thead>
            <tr style="background: #F7FAFB; border-bottom: 2px solid #DCE7EB;">
              <th style="text-align: left; padding: 14px 16px; font-size: 11px; color: #5B7A8C; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Item</th>
              <th style="text-align: center; padding: 14px 16px; font-size: 11px; color: #5B7A8C; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Qty</th>
              <th style="text-align: right; padding: 14px 16px; font-size: 11px; color: #5B7A8C; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Price</th>
              <th style="text-align: right; padding: 14px 16px; font-size: 11px; color: #5B7A8C; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <!-- Totals -->
        <div style="background: #F7FAFB; border-radius: 12px; padding: 24px; border: 1px solid #DCE7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 14px; color: #5B7A8C; padding: 8px 0;">Subtotal</td>
              <td style="font-size: 14px; color: #07203A; text-align: right; padding: 8px 0; font-weight: 500;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 14px; color: #5B7A8C; padding: 8px 0;">${isPickup ? 'Pickup' : 'Shipping'}</td>
              <td style="font-size: 14px; color: #07203A; text-align: right; padding: 8px 0; font-weight: 500;">${isPickup ? 'Free' : `$${shipping.toFixed(2)}`}</td>
            </tr>
            <tr style="border-top: 2px solid #DCE7EB;">
              <td style="font-size: 18px; font-weight: 700; color: #07203A; padding: 16px 0 0;">Total</td>
              <td style="font-size: 20px; font-weight: 700; color: #07203A; text-align: right; padding: 16px 0 0;">
                $${total.toFixed(2)} <span style="font-size: 14px; color: #438B9E;">${currency}</span>
              </td>
            </tr>
          </table>
        </div>

        <!-- Payment Instructions -->
        <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px; padding: 20px; margin-top: 24px; text-align: center;">
          <p style="font-size: 12px; color: #5B7A8C; margin: 0; line-height: 1.6;">
            ${paymentInstructions}
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 32px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 12px; color: #5B7A8C; margin: 0 0 8px;">
          VYTA Biosciences &bull; Premium Research Compounds &bull; Canada
        </p>
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          Questions? Reply to this email or contact us at ${process.env.SMTP_FROM_EMAIL}
        </p>
      </div>
    </div>
  `;

  try {
    const mailOptions = {
      from: fromEmail,
      to,
      subject: `Invoice ${orderNumber} - VYTA Biosciences`,
      html,
    };

    const info = await getTransporter().sendMail(mailOptions);
    console.log('Customer invoice sent:', info.messageId);
    return { success: true, id: info.messageId };
  } catch (error: any) {
    console.error('Error sending customer invoice:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send the customer a "payment received / order confirmed" email once an
 * e-Transfer invoice is fully paid. Uses the same SMTP channel as the invoice
 * email so it reliably reaches the customer (wording is Interac-accurate — no
 * blockchain copy). Best-effort: callers should not fail on a send error.
 */
export async function sendPaymentReceivedSMTP(data: {
  to: string;
  orderNumber: string;
  customerName?: string;
}) {
  const { to, orderNumber, customerName } = data;
  const greeting = customerName ? `Hi ${customerName},` : 'Hi there,';
  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 24px; font-weight: 700; color: #07203A; margin: 0; letter-spacing: 0.28em;">VYTA</h1>
        <p style="font-size: 10px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 6px 0 0;">BIOSCIENCES</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <div style="width: 48px; height: 48px; background: #ECFDF5; border-radius: 50%; margin: 0 auto 16px; line-height: 48px; font-size: 24px;">&#10003;</div>
        <h2 style="font-size: 20px; font-weight: 600; color: #07203A; margin: 0 0 8px;">Payment Received</h2>
        <p style="font-size: 14px; color: #5B7A8C; margin: 0 0 24px;">
          ${greeting} we&rsquo;ve received your Interac e-Transfer for order
          <strong>${orderNumber}</strong>. Your order is now being processed and
          we&rsquo;ll email your tracking details as soon as it ships.
        </p>
        <div style="background: #F7FAFB; border-radius: 8px; padding: 16px; margin-bottom: 8px;">
          <p style="font-size: 12px; color: #5B7A8C; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Order Number</p>
          <p style="font-size: 16px; font-weight: 600; color: #07203A; margin: 0; font-family: monospace;">${orderNumber}</p>
        </div>
      </div>
      <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          VYTA Biosciences &bull; Canada<br/>Questions? Reply to this email or contact us at ${process.env.SMTP_FROM_EMAIL}
        </p>
      </div>
    </div>
  `;
  try {
    const info = await getTransporter().sendMail({
      from: fromEmail,
      to,
      subject: `Payment received — order ${orderNumber}`,
      html,
    });
    return { success: true, id: info.messageId };
  } catch (error: any) {
    console.error('Error sending payment-received email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send admin notification for new order (email checkout) - SMTP Version
 * Supports multiple admin email addresses
 */
export async function sendAdminInvoiceNotificationSMTP(data: {
  adminEmails: string | string[];
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
  fulfillmentType?: 'shipping' | 'pickup';
  paymentMethod?: 'etransfer' | 'btc';
  referralCode?: string;
  currency?: string;
}) {
  const { adminEmails, orderNumber, customerName, customerEmail, items, subtotal, shipping, total, shippingAddress, fulfillmentType = 'shipping', paymentMethod = 'etransfer', referralCode, currency = 'CAD' } = data;
  const isPickup = fulfillmentType === 'pickup';
  const paymentLabel = paymentMethod === 'btc' ? 'Bitcoin (BTC)' : 'Interac e-Transfer';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const itemList = items
    .map(i => `<li style="font-size: 14px; color: #07203A; padding: 6px 0; border-bottom: 1px solid #DCE7EB;">
      <strong>${i.name}</strong>${i.strength ? ` - ${i.strength}` : ''} × ${i.quantity}
      <span style="float: right; color: #5B7A8C;">$${(i.price * i.quantity).toFixed(2)}</span>
    </li>`)
    .join('');

  const html = `
    <div style="max-width: 650px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #DCE7EB; background: #FFFFFF;">
        <h1 style="font-size: 28px; font-weight: 700; color: #07203A; margin: 0 0 4px; letter-spacing: 0.28em;">VYTA</h1>
        <p style="font-size: 10px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 6px 0 0;">BIOSCIENCES</p>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #6EB2B8; margin: 12px 0 0; text-transform: uppercase; font-weight: 600;">New Order Notification</p>
      </div>

      <!-- Alert -->
      <div style="padding: 32px 24px; background: #FFFFFF;">
        <div style="background: #F7FAFB; border: 2px solid #438B9E; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <h2 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0;">New Order Received</h2>
        </div>

        <!-- Order Details -->
        <div style="background: #F7FAFB; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #DCE7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Order Number</td>
              <td style="font-size: 14px; font-weight: 700; color: #07203A; padding: 8px 0; text-align: right; font-family: monospace;">${orderNumber}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Customer</td>
              <td style="font-size: 14px; font-weight: 600; color: #07203A; padding: 8px 0; text-align: right;">${customerName}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Email</td>
              <td style="font-size: 14px; color: #07203A; padding: 8px 0; text-align: right;">${customerEmail}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Payment Method</td>
              <td style="font-size: 14px; font-weight: 600; color: #07203A; padding: 8px 0; text-align: right;">${paymentLabel}</td>
            </tr>
            <tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total</td>
              <td style="font-size: 18px; font-weight: 700; color: #438B9E; padding: 8px 0; text-align: right;">$${total.toFixed(2)} ${currency}</td>
            </tr>
            ${referralCode ? `<tr>
              <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Referral Code</td>
              <td style="font-size: 14px; font-weight: 700; color: #15803D; padding: 8px 0; text-align: right; font-family: monospace;">${referralCode}</td>
            </tr>` : ''}
          </table>
        </div>

        <!-- Fulfillment -->
        <div style="background: #F7FAFB; border: 1px solid #DCE7EB; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="font-size: 11px; color: #438B9E; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">${isPickup ? 'Fulfillment — Local Pickup' : 'Shipping Address'}</p>
          ${isPickup ? '<p style="display: inline-block; font-size: 11px; font-weight: 700; color: #FFFFFF; background: #07203A; padding: 3px 10px; border-radius: 6px; letter-spacing: 0.08em; margin: 0 0 12px;">PICKUP</p>' : ''}
          <p style="font-size: 14px; color: #07203A; margin: 0; line-height: 1.7;">
            ${shippingAddress.address}<br/>
            ${[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode].filter(Boolean).join(', ')}${[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode].filter(Boolean).length ? '<br/>' : ''}
            ${shippingAddress.country === 'CA' ? 'Canada' : shippingAddress.country}
          </p>
        </div>

        <!-- Order Items -->
        <div style="margin-bottom: 24px;">
          <p style="font-size: 12px; color: #5B7A8C; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Order Items</p>
          <ul style="margin: 0; padding: 0; list-style: none; background: #F7FAFB; border: 1px solid #DCE7EB; border-radius: 12px; padding: 16px;">
            ${itemList}
          </ul>
        </div>

        <!-- Totals -->
        <div style="background: #F7FAFB; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #DCE7EB;">
          <table style="width: 100%;">
            <tr>
              <td style="font-size: 14px; color: #5B7A8C; padding: 6px 0;">Subtotal</td>
              <td style="font-size: 14px; color: #07203A; text-align: right; padding: 6px 0; font-weight: 500;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size: 14px; color: #5B7A8C; padding: 6px 0;">${isPickup ? 'Pickup' : 'Shipping'}</td>
              <td style="font-size: 14px; color: #07203A; text-align: right; padding: 6px 0; font-weight: 500;">${isPickup ? 'Free' : `$${shipping.toFixed(2)}`}</td>
            </tr>
            <tr style="border-top: 2px solid #DCE7EB;">
              <td style="font-size: 16px; font-weight: 700; color: #07203A; padding: 12px 0 0;">Total</td>
              <td style="font-size: 18px; font-weight: 700; color: #438B9E; text-align: right; padding: 12px 0 0;">$${total.toFixed(2)} ${currency}</td>
            </tr>
          </table>
        </div>

        ${paymentMethod === 'etransfer' ? `
        <!-- Action Needed -->
        <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <p style="font-size: 12px; color: #5B7A8C; margin: 0; line-height: 1.6;">
            <strong style="color: #07203A;">Action needed:</strong> Send Interac e-Transfer payment instructions to
            <a href="mailto:${customerEmail}" style="color: #438B9E; font-weight: 600;">${customerEmail}</a>.
            The customer has been told instructions will follow shortly.
          </p>
        </div>
        ` : ''}

        <!-- Action Button -->
        <div style="text-align: center;">
          <a href="${baseUrl}/admin/orders" style="display: inline-block; padding: 14px 32px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">
            View in Admin Dashboard
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          This is an automated notification from VYTA Admin System
        </p>
      </div>
    </div>
  `;

  // Convert adminEmails to array if it's a string
  const emailList = Array.isArray(adminEmails) ? adminEmails : [adminEmails];

  // Filter out empty emails
  const validEmails = emailList.filter(email => email && email.trim());

  if (validEmails.length === 0) {
    console.warn('No valid admin emails provided for notification');
    return { success: false, error: 'No admin emails configured' };
  }

  try {
    // Send to all admin emails
    const results = await Promise.allSettled(
      validEmails.map(async (email) => {
        const mailOptions = {
          from: fromEmail,
          to: email,
          subject: `New Order ${orderNumber} - $${total.toFixed(2)} ${currency}`,
          html,
        };

        const info = await getTransporter().sendMail(mailOptions);
        console.log(`Admin notification sent to ${email}:`, info.messageId);
        return info;
      })
    );

    // Check if at least one email was sent successfully
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;

    if (successCount > 0) {
      console.log(`Admin notifications sent: ${successCount} success, ${failureCount} failed`);
      return {
        success: true,
        message: `Sent to ${successCount}/${validEmails.length} admin emails`
      };
    } else {
      console.error('All admin notification emails failed');
      return { success: false, error: 'Failed to send to any admin emails' };
    }
  } catch (error: any) {
    console.error('Error sending admin notifications:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify a customer that an out-of-stock product is available again - SMTP Version
 */
export async function sendBackInStockNotification(data: {
  to: string;
  productName: string;
  productSlug?: string;
  imageUrl?: string | null;
  strength?: string | null;
  price?: number | null;
}) {
  const { to, productName, productSlug, imageUrl, strength, price } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const productUrl = productSlug ? `${baseUrl}/products/${productSlug}` : `${baseUrl}/products`;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 32px; text-align: center; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 22px; font-weight: 700; color: #07203A; margin: 0;">Back in Stock</h1>
        <p style="font-size: 13px; color: #5B7A8C; margin: 8px 0 0;">A compound from your watchlist is available again</p>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <div style="border: 1px solid #DCE7EB; border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 16px;">
          ${imageUrl ? `<img src="${imageUrl}" alt="${productName}" width="72" height="72" style="width: 72px; height: 72px; object-fit: contain; border-radius: 8px; background: #F7FAFB;" />` : ''}
          <div>
            <p style="font-size: 16px; font-weight: 600; color: #07203A; margin: 0 0 4px;">${productName}</p>
            ${strength ? `<p style="font-size: 13px; color: #5B7A8C; margin: 0 0 4px;">${strength}</p>` : ''}
            ${price ? `<p style="font-size: 15px; font-weight: 700; color: #07203A; margin: 0;">$${price}</p>` : ''}
          </div>
        </div>

        <p style="font-size: 14px; line-height: 1.6; color: #07203A; margin: 24px 0;">
          Good news — <strong>${productName}</strong> is back in stock. Quantities can be limited, so order soon to secure yours.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${productUrl}" style="display: inline-block; padding: 12px 28px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            View Product
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 32px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 12px; color: #5B7A8C; margin: 0 0 8px;">
          VYTA Biosciences &bull; Premium Research Compounds &bull; Canada
        </p>
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          You received this because you asked to be notified when this product was restocked.
        </p>
      </div>
    </div>
  `;

  try {
    const info = await getTransporter().sendMail({
      from: fromEmail,
      to,
      subject: `Back in stock: ${productName}`,
      html,
    });
    console.log('Back-in-stock notification sent:', info.messageId);
    return { success: true, id: info.messageId };
  } catch (error: any) {
    console.error('Error sending back-in-stock notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify admins that a product has hit its low-stock threshold - SMTP Version.
 * Sends to every configured admin email. Best-effort: individual failures are
 * logged and the call still resolves as long as one send succeeds.
 */
export async function sendLowStockAlert(data: {
  adminEmails: string | string[];
  productName: string;
  currentStock: number;
  threshold: number;
  productSlug?: string | null;
  strength?: string | null;
}) {
  const { adminEmails, productName, currentStock, threshold, productSlug, strength } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const productsUrl = `${baseUrl}/admin/products`;
  const isOut = currentStock <= 0;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 32px; text-align: center; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 22px; font-weight: 700; color: ${isOut ? '#B91C1C' : '#B45309'}; margin: 0;">
          ${isOut ? 'Out of Stock' : 'Low Stock Alert'}
        </h1>
        <p style="font-size: 13px; color: #5B7A8C; margin: 8px 0 0;">A product needs restocking</p>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <div style="border: 1px solid #DCE7EB; border-radius: 12px; padding: 20px;">
          <p style="font-size: 16px; font-weight: 600; color: #07203A; margin: 0 0 4px;">${productName}</p>
          ${strength ? `<p style="font-size: 13px; color: #5B7A8C; margin: 0 0 12px;">${strength}</p>` : ''}
          <table style="width: 100%; font-size: 14px; color: #07203A; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #5B7A8C;">Current stock</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700; color: ${isOut ? '#B91C1C' : '#B45309'};">${currentStock}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #5B7A8C;">Alert threshold</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${threshold}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 14px; line-height: 1.6; color: #07203A; margin: 24px 0;">
          <strong>${productName}</strong> has ${isOut ? 'sold out' : `dropped to ${currentStock} unit${currentStock === 1 ? '' : 's'}`}.
          Restock soon to avoid backorders.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${productsUrl}" style="display: inline-block; padding: 12px 28px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Manage Products
          </a>
        </div>
        ${productSlug ? `<p style="font-size: 12px; color: #8FA9B6; text-align: center; margin: 0;">${baseUrl}/products/${productSlug}</p>` : ''}
      </div>

      <!-- Footer -->
      <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          This is an automated notification from VYTA Admin System
        </p>
      </div>
    </div>
  `;

  const emailList = Array.isArray(adminEmails) ? adminEmails : [adminEmails];
  const validEmails = emailList.filter((email) => email && email.trim());
  if (validEmails.length === 0) {
    console.warn('No valid admin emails provided for low-stock alert');
    return { success: false, error: 'No admin emails configured' };
  }

  try {
    const results = await Promise.allSettled(
      validEmails.map(async (email) => {
        const info = await getTransporter().sendMail({
          from: fromEmail,
          to: email,
          subject: `${isOut ? 'Out of stock' : 'Low stock'}: ${productName} (${currentStock} left)`,
          html,
        });
        console.log(`Low-stock alert sent to ${email}:`, info.messageId);
        return info;
      }),
    );
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    if (successCount > 0) {
      return { success: true, message: `Sent to ${successCount}/${validEmails.length} admin emails` };
    }
    return { success: false, error: 'Failed to send to any admin emails' };
  } catch (error: any) {
    console.error('Error sending low-stock alert:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify admins that a customer has requested to become an affiliate.
 */
export async function sendAffiliateRequestAdminNotification(data: {
  adminEmails: string | string[];
  applicantName: string;
  applicantEmail: string;
  message?: string | null;
  walletAddress?: string | null;
}) {
  const { adminEmails, applicantName, applicantEmail, message, walletAddress } = data;
  const list = (Array.isArray(adminEmails) ? adminEmails : [adminEmails])
    .map((e) => e.trim())
    .filter(Boolean);
  if (list.length === 0) return { success: false, error: 'No admin emails configured' };

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 28px 32px; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0;">New affiliate request</h1>
      </div>
      <div style="padding: 28px 32px;">
        <p style="font-size: 14px; color: #07203A; margin: 0 0 16px;">
          <strong>${applicantName}</strong> (${applicantEmail}) has requested to become an affiliate.
        </p>
        ${walletAddress ? `<p style="font-size: 13px; color: #5B7A8C; margin: 0 0 8px;">Wallet: ${walletAddress}</p>` : ''}
        ${message ? `<div style="font-size: 13px; color: #07203A; background: #F7FAFB; border: 1px solid #DCE7EB; border-radius: 8px; padding: 12px; white-space: pre-wrap;">${message}</div>` : ''}
        <div style="text-align: center; margin: 28px 0 4px;">
          <a href="${baseUrl}/admin/affiliates" style="display: inline-block; padding: 12px 28px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Review request</a>
        </div>
      </div>
    </div>
  `;

  try {
    const info = await getTransporter().sendMail({
      from: fromEmail,
      to: list,
      subject: `New affiliate request: ${applicantName}`,
      html,
    });
    return { success: true, id: info.messageId };
  } catch (error: any) {
    console.error('Error sending affiliate request notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify admins that a new customer has registered an account.
 * Sends to every configured admin email. Best-effort: individual failures are
 * logged and the call still resolves as long as one send succeeds.
 */
export async function sendNewCustomerAdminNotification(data: {
  adminEmails: string | string[];
  customerName: string;
  customerEmail: string;
  phone?: string | null;
  referredBy?: string | null;
  registeredAt?: string | null;
  /** Customer id — used to build the "take over" contact link. */
  customerId?: string | null;
}) {
  const { adminEmails, customerName, customerEmail, phone, referredBy, registeredAt, customerId } = data;
  const list = (Array.isArray(adminEmails) ? adminEmails : [adminEmails])
    .map((e) => e.trim())
    .filter(Boolean);
  if (list.length === 0) return { success: false, error: 'No admin emails configured' };

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const registeredLabel = registeredAt
    ? new Date(registeredAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const row = (label: string, value: string) => `
    <tr>
      <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${label}</td>
      <td style="font-size: 14px; font-weight: 600; color: #07203A; padding: 8px 0; text-align: right;">${value}</td>
    </tr>`;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <!-- Header -->
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #DCE7EB; background: #FFFFFF;">
        <h1 style="font-size: 28px; font-weight: 700; color: #07203A; margin: 0 0 4px; letter-spacing: 0.28em;">VYTA</h1>
        <p style="font-size: 10px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 6px 0 0;">BIOSCIENCES</p>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #5B7A8C; margin: 12px 0 0; text-transform: uppercase; font-weight: 600;">New Customer Registration</p>
      </div>

      <div style="padding: 32px 24px; background: #FFFFFF;">
        <div style="background: #F7FAFB; border: 2px solid #438B9E; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <h2 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0;">New Customer Registered</h2>
        </div>

        <!-- Customer Details -->
        <div style="background: #F7FAFB; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #DCE7EB;">
          <table style="width: 100%;">
            ${row('Name', customerName)}
            ${row('Email', `<a href="mailto:${customerEmail}" style="color: #438B9E; font-weight: 600; text-decoration: none;">${customerEmail}</a>`)}
            ${phone ? row('Phone', `<a href="tel:${phone}" style="color: #438B9E; font-weight: 600; text-decoration: none;">${phone}</a>`) : row('Phone', '—')}
            ${referredBy ? row('Referred By', referredBy) : ''}
            ${registeredLabel ? row('Registered', registeredLabel) : ''}
          </table>
        </div>

        <!-- Action Buttons -->
        <div style="text-align: center;">
          ${customerId ? `<a href="${baseUrl}/admin/customers/${customerId}/takeover" style="display: inline-block; padding: 14px 32px; background: #438B9E; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; margin-bottom: 12px;">
            Take over &amp; contact this customer
          </a><br>` : ''}
          <a href="${baseUrl}/admin/customers" style="display: inline-block; padding: 12px 28px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.02em;">
            View in Admin Dashboard
          </a>
        </div>
        ${customerId ? `<p style="text-align: center; font-size: 11px; color: #8FA9B6; margin: 16px 0 0;">On the takeover page you can see their orders, cart, and claim them for contacting.</p>` : ''}
      </div>

      <!-- Footer -->
      <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          This is an automated notification from VYTA Admin System
        </p>
      </div>
    </div>
  `;

  try {
    const results = await Promise.allSettled(
      list.map(async (email) => {
        const info = await getTransporter().sendMail({
          from: fromEmail,
          to: email,
          subject: `New customer registered: ${customerName}`,
          html,
        });
        console.log(`New-customer notification sent to ${email}:`, info.messageId);
        return info;
      }),
    );
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    if (successCount > 0) {
      return { success: true, message: `Sent to ${successCount}/${list.length} admin emails` };
    }
    return { success: false, error: 'Failed to send to any admin emails' };
  } catch (error: any) {
    console.error('Error sending new-customer notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Alert admins that a customer registered but still hasn't ordered after a
 * configured number of days. Includes a link to take over / contact them.
 */
export async function sendInactiveCustomerAdminNotification(data: {
  adminEmails: string | string[];
  customerName: string;
  customerEmail: string;
  phone?: string | null;
  daysSinceRegistration: number;
  registeredAt?: string | null;
  hasCartItems?: boolean;
  customerId?: string | null;
}) {
  const {
    adminEmails, customerName, customerEmail, phone,
    daysSinceRegistration, registeredAt, hasCartItems, customerId,
  } = data;
  const list = (Array.isArray(adminEmails) ? adminEmails : [adminEmails])
    .map((e) => e.trim())
    .filter(Boolean);
  if (list.length === 0) return { success: false, error: 'No admin emails configured' };

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const registeredLabel = registeredAt
    ? new Date(registeredAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const row = (label: string, value: string) => `
    <tr>
      <td style="font-size: 12px; color: #5B7A8C; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${label}</td>
      <td style="font-size: 14px; font-weight: 600; color: #07203A; padding: 8px 0; text-align: right;">${value}</td>
    </tr>`;

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFFFF;">
      <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #DCE7EB; background: #FFFFFF;">
        <h1 style="font-size: 28px; font-weight: 700; color: #07203A; margin: 0 0 4px; letter-spacing: 0.28em;">VYTA</h1>
        <p style="font-size: 10px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 6px 0 0;">BIOSCIENCES</p>
        <p style="font-size: 11px; letter-spacing: 0.15em; color: #5B7A8C; margin: 12px 0 0; text-transform: uppercase; font-weight: 600;">Inactive Customer Alert</p>
      </div>

      <div style="padding: 32px 24px; background: #FFFFFF;">
        <div style="background: #FFF7ED; border: 2px solid #F59E0B; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <h2 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0 0 4px;">No order after ${daysSinceRegistration} day${daysSinceRegistration === 1 ? '' : 's'}</h2>
          <p style="font-size: 13px; color: #92400E; margin: 0;">This customer registered but still hasn't placed an order.</p>
        </div>

        <div style="background: #F7FAFB; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #DCE7EB;">
          <table style="width: 100%;">
            ${row('Name', customerName)}
            ${row('Email', `<a href="mailto:${customerEmail}" style="color: #438B9E; font-weight: 600; text-decoration: none;">${customerEmail}</a>`)}
            ${phone ? row('Phone', `<a href="tel:${phone}" style="color: #438B9E; font-weight: 600; text-decoration: none;">${phone}</a>`) : row('Phone', '—')}
            ${registeredLabel ? row('Registered', registeredLabel) : ''}
            ${row('In cart', hasCartItems ? 'Yes — has items waiting' : 'No')}
          </table>
        </div>

        <div style="text-align: center;">
          ${customerId ? `<a href="${baseUrl}/admin/customers/${customerId}/takeover" style="display: inline-block; padding: 14px 32px; background: #438B9E; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">
            Take over &amp; contact this customer
          </a>` : `<a href="${baseUrl}/admin/customers" style="display: inline-block; padding: 14px 32px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600;">View in Admin Dashboard</a>`}
        </div>
      </div>

      <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
        <p style="font-size: 11px; color: #8FA9B6; margin: 0;">
          This is an automated notification from VYTA Admin System
        </p>
      </div>
    </div>
  `;

  try {
    const results = await Promise.allSettled(
      list.map(async (email) => {
        const info = await getTransporter().sendMail({
          from: fromEmail,
          to: email,
          subject: `Inactive customer (${daysSinceRegistration}d, no order): ${customerName}`,
          html,
        });
        console.log(`Inactive-customer notification sent to ${email}:`, info.messageId);
        return info;
      }),
    );
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    if (successCount > 0) {
      return { success: true, message: `Sent to ${successCount}/${list.length} admin emails` };
    }
    return { success: false, error: 'Failed to send to any admin emails' };
  } catch (error: any) {
    console.error('Error sending inactive-customer notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify an applicant that their affiliate request was approved or denied.
 */
export async function sendAffiliateRequestDecision(data: {
  to: string;
  applicantName: string;
  approved: boolean;
  referralCode?: string | null;
}) {
  const { to, applicantName, approved, referralCode } = data;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

  const html = approved
    ? `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 28px 32px; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0;">You're a VYTA affiliate 🎉</h1>
      </div>
      <div style="padding: 28px 32px;">
        <p style="font-size: 14px; line-height: 1.6; color: #07203A; margin: 0 0 16px;">
          Hi ${applicantName}, your affiliate request has been approved. Sign in to access your affiliate portal.
        </p>
        ${referralCode ? `<p style="font-size: 14px; color: #07203A; margin: 0 0 16px;">Your referral code: <strong style="font-family: monospace;">${referralCode}</strong></p>` : ''}
        <div style="text-align: center; margin: 28px 0 4px;">
          <a href="${baseUrl}/admin" style="display: inline-block; padding: 12px 28px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">Open affiliate portal</a>
        </div>
      </div>
    </div>`
    : `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="padding: 28px 32px; border-bottom: 1px solid #DCE7EB;">
        <h1 style="font-size: 20px; font-weight: 700; color: #07203A; margin: 0;">Affiliate request update</h1>
      </div>
      <div style="padding: 28px 32px;">
        <p style="font-size: 14px; line-height: 1.6; color: #07203A; margin: 0;">
          Hi ${applicantName}, thanks for your interest in the VYTA affiliate program. We're unable to approve your request at this time. If you have questions, just reply to this email.
        </p>
      </div>
    </div>`;

  try {
    const info = await getTransporter().sendMail({
      from: fromEmail,
      to,
      subject: approved ? "You're now a VYTA affiliate" : 'Your affiliate request',
      html,
    });
    return { success: true, id: info.messageId };
  } catch (error: any) {
    console.error('Error sending affiliate decision email:', error);
    return { success: false, error: error.message };
  }
}
