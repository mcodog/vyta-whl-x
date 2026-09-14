"use client";

import { motion } from "framer-motion";
import { ShoppingBag, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { featuredProducts } from "@/data/products";

export default function Products() {
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 40 },
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
    <section id="products" className="py-24 sm:py-32 bg-neutral-50/50">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12 sm:mb-16"
        >
          <div>
            <span className="inline-block px-4 py-1.5 bg-emerald-50 text-emerald-600 text-sm font-medium rounded-full mb-6">
              Our Products
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-neutral-900 tracking-tight">
              Research-Grade Peptides
            </h2>
          </div>
          <Link
            href="/products"
            className="group flex items-center gap-2 text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
          >
            View All Products
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </motion.div>

        {/* Products Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {featuredProducts.map((product) => (
            <motion.div
              key={product.id}
              variants={itemVariants}
              className="group relative bg-white rounded-2xl border border-neutral-100 hover:border-neutral-200 overflow-hidden transition-all duration-500 hover:shadow-xl hover:shadow-neutral-900/5"
            >
              {/* Badge */}
              {product.badge && (
                <div className="absolute top-4 left-4 z-10">
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                    product.badge === "Best Seller"
                      ? "bg-amber-50 text-amber-600"
                      : product.badge === "Popular"
                      ? "bg-blue-50 text-blue-600"
                      : "bg-emerald-50 text-emerald-600"
                  }`}>
                    {product.badge}
                  </span>
                </div>
              )}

              {/* Product Image Area */}
              <div className="relative aspect-[4/3] bg-gradient-to-br from-neutral-100 to-neutral-50 p-4 flex items-center justify-center">
                <div className="relative w-full h-full">
                  <Image
                    src={`/images/products/${encodeURIComponent(product.image)}`}
                    alt={`${product.name} ${product.strength}`}
                    fill
                    className="object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Product Info */}
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <span className="text-xs text-emerald-600 font-medium uppercase tracking-wider">
                      {product.category}
                    </span>
                    <h3 className="text-lg font-semibold text-neutral-900 mt-1">
                      {product.name} <span className="text-neutral-500 font-normal">{product.strength}</span>
                    </h3>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-semibold text-neutral-900">
                      CA${product.price}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-neutral-500 leading-relaxed mb-4 line-clamp-2">
                  {product.shortDescription}
                </p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                    <span className="text-xs text-neutral-400">99%+ Purity</span>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-full transition-colors group-hover:bg-emerald-500">
                    <ShoppingBag className="w-4 h-4" />
                    Add
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mt-16 text-center"
        >
          <p className="text-neutral-500 mb-6">
            Looking for something specific? We carry over 60 research peptides.
          </p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 px-8 py-4 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-full transition-all duration-300 hover:shadow-lg"
          >
            Browse Full Catalog
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
