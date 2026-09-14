'use client';

import React, { useState } from 'react';
import Image, { type ImageProps } from 'next/image';

/**
 * next/image wrapper that shows a pulsing skeleton in place until the image has
 * decoded, then fades it in. Keeps grids/cards from popping as images arrive.
 * The parent must be positioned (relative) since the skeleton is absolute.
 */
export default function FadeInImage({ className = '', ...props }: ImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <div
        className={`absolute inset-0 bg-surface animate-pulse transition-opacity duration-500 ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden="true"
      />
      <Image
        {...props}
        onLoad={() => setLoaded(true)}
        className={`${className} transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}
