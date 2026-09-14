"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function CTA() {
  return (
    <section className="py-24 sm:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative overflow-hidden rounded-3xl bg-neutral-950 px-8 py-20 sm:px-16 sm:py-28"
        >
          {/* Background Effects */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-emerald-600/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10 max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-white tracking-tight mb-6">
              Ready to Advance
              <br />
              Your Research?
            </h2>
            <p className="text-lg text-neutral-400 mb-10 leading-relaxed">
              Join thousands of researchers worldwide who trust Aminocan
              for their peptide research needs.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="#products"
                className="group flex items-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-medium rounded-full transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/25"
              >
                Start Shopping
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="#contact"
                className="px-8 py-4 text-white/70 hover:text-white font-medium rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
