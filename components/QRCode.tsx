'use client';

import React from 'react';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export default function QRCode({ value, size = 200, className = '' }: QRCodeProps) {
  if (!value) {
    return (
      <div
        className={`bg-gray-100 rounded-lg flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-gray-400 text-sm">No address</span>
      </div>
    );
  }

  // Use QR Server API (free and reliable)
  const encodedValue = encodeURIComponent(value);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodedValue}&format=svg`;

  return (
    <div className={`relative ${className}`}>
      <img
        src={qrUrl}
        alt="Payment QR Code"
        width={size}
        height={size}
        className="rounded-lg"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
