"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ShoppingBag, User } from "lucide-react";
import Link from "next/link";

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Products", href: "#products" },
    { name: "Research", href: "#research" },
    { name: "Quality", href: "#quality" },
    { name: "Contact", href: "#contact" },
  ];

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          isScrolled
            ? "glass border-b border-neutral-200/50 py-4"
            : "bg-transparent py-6"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl transform group-hover:scale-105 transition-transform duration-300" />
                <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
                  A
                </span>
              </div>
              <span className={`text-xl font-semibold tracking-tight transition-colors duration-300 ${
                isScrolled ? "text-neutral-900" : "text-white"
              }`}>
                Aminocan
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 hover:bg-neutral-100/80 ${
                    isScrolled
                      ? "text-neutral-600 hover:text-neutral-900"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </div>

            {/* Desktop Actions */}
            <div className="hidden md:flex items-center gap-2">
              <button
                className={`p-2.5 rounded-full transition-all duration-300 ${
                  isScrolled
                    ? "text-neutral-600 hover:bg-neutral-100"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
              >
                <User className="w-5 h-5" />
              </button>
              <button
                className={`p-2.5 rounded-full transition-all duration-300 relative ${
                  isScrolled
                    ? "text-neutral-600 hover:bg-neutral-100"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
              >
                <ShoppingBag className="w-5 h-5" />
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  0
                </span>
              </button>
              <Link
                href="#products"
                className="ml-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-full transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/25"
              >
                Shop Now
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className={`md:hidden p-2 rounded-lg transition-colors ${
                isScrolled ? "text-neutral-900" : "text-white"
              }`}
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 pt-24 bg-white md:hidden"
          >
            <div className="px-6 py-8 space-y-2">
              {navLinks.map((link, index) => (
                <motion.div
                  key={link.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-4 py-4 text-lg font-medium text-neutral-900 hover:bg-neutral-50 rounded-xl transition-colors"
                  >
                    {link.name}
                  </Link>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="pt-6"
              >
                <Link
                  href="#products"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block w-full px-6 py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center font-medium rounded-xl transition-colors"
                >
                  Shop Now
                </Link>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
