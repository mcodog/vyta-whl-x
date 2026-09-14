"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, Search, ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { products, categories, getProductsByCategory } from "@/data/products";

export default function ProductsPage() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const filteredProducts = getProductsByCategory(selectedCategory).filter(
    (product) =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.shortDescription.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-neutral-950">
      <Navigation />

      {/* Hero with dark background */}
      <section className="pt-32 pb-12 bg-neutral-950 border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl sm:text-5xl font-semibold text-white tracking-tight mb-4">
              Products
            </h1>
            <p className="text-lg text-neutral-400 max-w-xl">
              Research-grade peptides with 99%+ purity
            </p>
          </motion.div>

          {/* Filter Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex items-center gap-4 mt-8"
          >
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-all"
              />
            </div>

            {/* Category Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-lg text-sm font-medium text-white transition-colors"
              >
                {selectedCategory}
                <ChevronDown className={`w-4 h-4 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showCategoryDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full right-0 mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl py-2 z-50"
                  >
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => {
                          setSelectedCategory(category);
                          setShowCategoryDropdown(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          selectedCategory === category
                            ? "bg-emerald-500/20 text-emerald-400 font-medium"
                            : "text-neutral-300 hover:bg-neutral-800"
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Results Count */}
            <span className="text-sm text-neutral-500 hidden sm:block">
              {filteredProducts.length} products
            </span>
          </motion.div>
        </div>
      </section>

      {/* Products Grid */}
      <section className="py-12 bg-neutral-900">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedCategory + searchQuery}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
            >
              {filteredProducts.map((product, index) => (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
                  className="group bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/5"
                >
                  {/* Product Image */}
                  <Link href={`/products/${product.id}`}>
                    <div className="relative aspect-square bg-white p-6">
                      {product.badge && (
                        <span className={`absolute top-3 left-3 px-2.5 py-1 text-xs font-medium rounded-full ${
                          product.badge === "Best Seller"
                            ? "bg-amber-500/20 text-amber-400"
                            : product.badge === "Popular"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}>
                          {product.badge}
                        </span>
                      )}
                      <Image
                        src={`/images/products/${encodeURIComponent(product.image)}`}
                        alt={`${product.name} ${product.strength}`}
                        fill
                        className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    </div>
                  </Link>

                  {/* Product Info */}
                  <div className="p-4 border-t border-neutral-800">
                    <Link href={`/products/${product.id}`}>
                      <h3 className="font-medium text-white group-hover:text-emerald-400 transition-colors">
                        {product.name}
                        <span className="text-neutral-500 font-normal ml-1">{product.strength}</span>
                      </h3>
                    </Link>
                    <p className="text-sm text-neutral-500 mt-1 line-clamp-1">
                      {product.shortDescription}
                    </p>

                    <div className="flex items-center justify-between mt-4">
                      <span className="font-semibold text-white">CA${product.price}</span>
                      <button className="p-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full transition-colors">
                        <ShoppingBag className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>

          {filteredProducts.length === 0 && (
            <div className="text-center py-20">
              <p className="text-neutral-500">No products found</p>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
                }}
                className="mt-2 text-emerald-400 text-sm font-medium hover:text-emerald-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
