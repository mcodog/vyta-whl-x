"use client";

import { motion } from "framer-motion";

const stats = [
  { value: "65+", label: "Research Peptides" },
  { value: "150+", label: "Countries Served" },
  { value: "99%+", label: "Purity Standard" },
  { value: "24h", label: "Processing Time" },
];

export default function Stats() {
  return (
    <section className="py-20 bg-neutral-900">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12"
        >
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="text-center"
            >
              <div className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-white mb-2">
                {stat.value}
              </div>
              <div className="text-sm sm:text-base text-neutral-400">
                {stat.label}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
