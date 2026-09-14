"use client";

import { motion } from "framer-motion";
import { ArrowRight, Shield, Truck, Award } from "lucide-react";
import Link from "next/link";

export default function Hero() {
  const badges = [
    { icon: Shield, text: "99%+ Purity" },
    { icon: Truck, text: "Worldwide Shipping" },
    { icon: Award, text: "Lab Certified" },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/hero-bg.jpg')" }}
      />
      {/* Overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/80" />
      <div className="absolute inset-0 bg-gradient-radial from-black/50 via-transparent to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 py-32">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-black/60 backdrop-blur-sm border border-emerald-500/30 rounded-full mb-8"
          >
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-sm text-white font-medium">Premium Research Grade</span>
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.05] mb-6"
            style={{ textShadow: "0 4px 20px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.9)" }}
          >
            The Future of
            <br />
            <span className="text-emerald-400">
              Peptide Research
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-lg sm:text-xl text-white font-medium max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ textShadow: "0 2px 10px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,1)" }}
          >
            Premium research peptides with uncompromising quality.
            Every batch third-party tested for purity and potency.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
          >
            <Link
              href="#products"
              className="group flex items-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-medium rounded-full transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/25"
            >
              Explore Products
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="#quality"
              className="px-8 py-4 text-white/70 hover:text-white font-medium rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300"
            >
              Our Quality Promise
            </Link>
          </motion.div>

          {/* Trust Badges */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-6 sm:gap-10"
          >
            {badges.map((badge, index) => (
              <div
                key={index}
                className="flex items-center gap-3 text-white/40"
              >
                <badge.icon className="w-5 h-5 text-emerald-400/60" />
                <span className="text-sm font-medium">{badge.text}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
}
