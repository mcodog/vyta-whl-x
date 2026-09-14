"use client";

import { motion } from "framer-motion";
import { Shield, FlaskConical, Truck, Clock, CreditCard, Headphones } from "lucide-react";

export default function Features() {
  const features = [
    {
      icon: FlaskConical,
      title: "99%+ Purity",
      description: "Every product undergoes rigorous HPLC and mass spectrometry analysis to ensure exceptional purity standards.",
    },
    {
      icon: Shield,
      title: "Third-Party Tested",
      description: "Independent laboratory verification for every batch. Certificates of analysis available upon request.",
    },
    {
      icon: Truck,
      title: "Worldwide Shipping",
      description: "Fast, discreet delivery to over 150 countries. Temperature-controlled packaging for product integrity.",
    },
    {
      icon: Clock,
      title: "Same-Day Processing",
      description: "Orders placed before 2 PM EST ship the same day. Track your package every step of the way.",
    },
    {
      icon: CreditCard,
      title: "Secure Payments",
      description: "Multiple payment options including cryptocurrency. Bank-level encryption for all transactions.",
    },
    {
      icon: Headphones,
      title: "Expert Support",
      description: "Dedicated research support team available 7 days a week. Technical guidance when you need it.",
    },
  ];

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  return (
    <section id="quality" className="py-24 sm:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-2xl mx-auto text-center mb-16 sm:mb-20"
        >
          <span className="inline-block px-4 py-1.5 bg-emerald-50 text-emerald-600 text-sm font-medium rounded-full mb-6">
            Why Aminocan
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-neutral-900 tracking-tight mb-6">
            Excellence in Every Detail
          </h2>
          <p className="text-lg text-neutral-500 leading-relaxed">
            We set the standard for research peptide quality. From synthesis to delivery,
            every step is optimized for your research success.
          </p>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
        >
          {features.map((feature, index) => (
            <motion.div
              key={index}
              variants={itemVariants}
              className="group relative p-8 bg-neutral-50/50 hover:bg-white border border-transparent hover:border-neutral-100 rounded-2xl transition-all duration-500 hover:shadow-xl hover:shadow-neutral-900/5"
            >
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-50 group-hover:bg-emerald-100 rounded-xl mb-6 transition-colors duration-300">
                <feature.icon className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 mb-3">
                {feature.title}
              </h3>
              <p className="text-neutral-500 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
