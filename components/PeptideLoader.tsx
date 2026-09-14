'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface PeptideLoaderProps {
  message?: string;
  type?: 'login' | 'logout';
}

export default function PeptideLoader({ message = 'Loading...', type = 'login' }: PeptideLoaderProps) {
  // Peptide chain - amino acids connected
  const nodes = [0, 1, 2, 3, 4];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-white via-primary-50/50 to-white"
    >
      {/* Peptide Chain Animation */}
      <div className="relative flex items-center space-x-3 mb-8">
        {nodes.map((i) => (
          <React.Fragment key={i}>
            {/* Amino Acid Node */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: [0, 1.2, 1],
                opacity: 1,
              }}
              transition={{
                delay: type === 'login' ? i * 0.15 : (nodes.length - 1 - i) * 0.15,
                duration: 0.4,
                ease: 'easeOut',
              }}
              className="relative"
            >
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 0 0 rgba(139, 92, 246, 0)',
                    '0 0 20px 10px rgba(139, 92, 246, 0.3)',
                    '0 0 0 0 rgba(139, 92, 246, 0)',
                  ],
                }}
                transition={{
                  delay: i * 0.15 + 0.5,
                  duration: 1.5,
                  repeat: Infinity,
                  repeatDelay: 0.5,
                }}
                className="w-4 h-4 rounded-full bg-gradient-to-br from-primary-500 to-accent-500"
              />
            </motion.div>

            {/* Peptide Bond (line between nodes) */}
            {i < nodes.length - 1 && (
              <motion.div
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{
                  delay: type === 'login' ? i * 0.15 + 0.2 : (nodes.length - 2 - i) * 0.15 + 0.2,
                  duration: 0.3,
                }}
                className="w-6 h-0.5 bg-gradient-to-r from-primary-400 to-accent-400 origin-left"
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Hexagon Background Pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-10">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 0.5, scale: 1 }}
            transition={{ delay: i * 0.1, duration: 1 }}
            className="absolute"
            style={{
              left: `${20 + (i % 3) * 30}%`,
              top: `${30 + Math.floor(i / 3) * 40}%`,
            }}
          >
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
              <path
                d="M30 5L52 17.5V42.5L30 55L8 42.5V17.5L30 5Z"
                stroke="currentColor"
                strokeWidth="1"
                className="text-primary-600"
              />
            </svg>
          </motion.div>
        ))}
      </div>

      {/* Message */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="text-gray-600 font-medium"
      >
        {message}
      </motion.p>

      {/* Brand */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-4 text-sm text-primary-600 font-semibold"
      >
        Aminocan Peptides
      </motion.p>
    </motion.div>
  );
}
