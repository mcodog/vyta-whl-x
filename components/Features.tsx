'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Beaker, Microscope, ShieldCheck, Award, FileCheck, Truck, Dna, TestTube, Pill, Brain, Heart, Sparkles, type LucideIcon } from 'lucide-react';
import { getStoreCategories, getCategoryIcon } from '@/lib/categories';

type HomeCategory = { name: string; slug: string; description: string; icon: LucideIcon };

// Shown until the controlled store_categories list resolves (and if it fails).
// Homepage categories are the "featured" ones, displayed with their home_label
// and subtitle. Editable in /admin/categories.
const FALLBACK_CATEGORIES: HomeCategory[] = [
  { name: 'Metabolic', slug: 'Weight Loss / Metabolic', description: 'GLP-1 Agonists', icon: TestTube },
  { name: 'Regenerative', slug: 'Healing / Recovery', description: 'Tissue Repair', icon: Heart },
  { name: 'Longevity', slug: 'Anti-Aging / Beauty', description: 'Cellular Health', icon: Sparkles },
  { name: 'Performance', slug: 'Bodybuilding / Fitness', description: 'Growth Factors', icon: Dna },
  { name: 'Nootropic', slug: 'Cognitive / Focus', description: 'Neuropeptides', icon: Brain },
  { name: 'Therapeutic', slug: 'General Health', description: 'Clinical Peptides', icon: Pill },
];

const certifications = [
  {
    icon: Microscope,
    title: 'HPLC Analysis',
    description: 'High-performance liquid chromatography verification',
  },
  {
    icon: ShieldCheck,
    title: 'GMP Standards',
    description: 'Good Manufacturing Practice certified facilities',
  },
  {
    icon: FileCheck,
    title: 'COA Included',
    description: 'Certificate of Analysis with every order',
  },
  {
    icon: Award,
    title: 'ISO Compliant',
    description: 'International quality management standards',
  },
];

export default function Features() {
  const [categories, setCategories] = useState<HomeCategory[]>(FALLBACK_CATEGORIES);

  useEffect(() => {
    let cancelled = false;
    getStoreCategories({ featuredOnly: true }).then((rows) => {
      if (cancelled || rows.length === 0) return;
      setCategories(
        rows.map((c) => ({
          name: c.home_label || c.name,
          slug: c.slug,
          description: c.description || '',
          icon: getCategoryIcon(c.icon),
        })),
      );
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {/* Research Categories */}
      <section className="py-16 sm:py-20 bg-surface">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-line rounded-full mb-4">
              <Beaker className="w-3.5 h-3.5 text-ink-muted" />
              <span className="text-xs font-medium text-ink-muted">Research Categories</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-3">
              Browse by Application
            </h2>
            <p className="text-ink-muted max-w-lg mx-auto">
              Pharmaceutical-grade peptides organized by research application
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
            {categories.map((category, index) => (
              <motion.div
                key={category.slug}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
              >
                <Link
                  href={`/products?category=${encodeURIComponent(category.slug)}`}
                  className="group block bg-white hover:bg-surface border border-line hover:border-ink/20 rounded-xl p-3 sm:p-5 text-center transition-all hover:shadow-lg hover:shadow-ink/5"
                >
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-ink rounded-lg sm:rounded-xl flex items-center justify-center mx-auto mb-2 sm:mb-3 group-hover:scale-110 transition-transform">
                    <category.icon className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-ink text-xs sm:text-sm mb-0.5">{category.name}</h3>
                  <p className="text-[10px] sm:text-xs text-ink-muted">{category.description}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Quality & Certifications */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left - Content */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/10 border border-bronze/20 rounded-full mb-4">
                <ShieldCheck className="w-3.5 h-3.5 text-bronze" />
                <span className="text-xs font-medium text-bronze">Quality Assurance</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-4">
                Pharmaceutical-Grade Standards
              </h2>
              <p className="text-ink-muted mb-8 leading-relaxed">
                Our commitment to research excellence means every peptide meets the highest
                purity standards. Each batch is independently verified through comprehensive
                analytical testing protocols.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                {certifications.map((cert, index) => (
                  <motion.div
                    key={cert.title}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-start gap-3 p-4 bg-surface rounded-xl border border-line"
                  >
                    <div className="w-10 h-10 bg-ink rounded-lg flex items-center justify-center flex-shrink-0">
                      <cert.icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink text-sm mb-0.5">{cert.title}</h3>
                      <p className="text-xs text-ink-muted">{cert.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right - Stats */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-ink rounded-2xl p-5 sm:p-8 text-white"
            >
              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <div className="text-center p-2 sm:p-4">
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-bronze mb-1 sm:mb-2 tabular-nums">99%+</div>
                  <div className="text-xs sm:text-sm text-white/60">Purity Standard</div>
                </div>
                <div className="text-center p-2 sm:p-4">
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-1 sm:mb-2 tabular-nums">50+</div>
                  <div className="text-xs sm:text-sm text-white/60">Compounds</div>
                </div>
                <div className="text-center p-2 sm:p-4">
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-1 sm:mb-2 tabular-nums">3rd</div>
                  <div className="text-xs sm:text-sm text-white/60">Party Tested</div>
                </div>
                <div className="text-center p-2 sm:p-4">
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-1 sm:mb-2 tabular-nums">24h</div>
                  <div className="text-xs sm:text-sm text-white/60">Processing</div>
                </div>
              </div>

              <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 sm:w-10 h-9 sm:h-10 bg-white/10 rounded-lg flex items-center justify-center">
                      <Truck className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">Discreet Shipping</div>
                      <div className="text-xs text-white/60">Canada-wide delivery</div>
                    </div>
                  </div>
                  <Link
                    href="/products"
                    className="text-sm font-medium text-bronze hover:text-bronze-light transition-colors"
                  >
                    View Products →
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Research Disclaimer */}
      <section className="py-6 sm:py-8 bg-ink">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-center sm:text-left">
            <div className="w-9 sm:w-10 h-9 sm:h-10 bg-bronze/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Beaker className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
            </div>
            <p className="text-xs sm:text-sm text-white/60">
              <span className="font-medium text-white">For Research Purposes Only.</span>{' '}
              All products are intended for laboratory and scientific research use.
              Not for human consumption. Must be 18+ to purchase.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
