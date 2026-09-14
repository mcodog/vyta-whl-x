"use client";

import Link from "next/link";
import { Mail, MapPin, MessageCircle } from "lucide-react";

export default function Footer() {
  const footerLinks = {
    Products: [
      { name: "Weight Loss", href: "/products?category=weight-loss" },
      { name: "Healing & Recovery", href: "/products?category=healing" },
      { name: "Anti-Aging", href: "/products?category=anti-aging" },
      { name: "Performance", href: "/products?category=performance" },
      { name: "All Products", href: "/products" },
    ],
    Company: [
      { name: "About Us", href: "/about" },
      { name: "Quality Assurance", href: "/quality" },
      { name: "Lab Reports", href: "/lab-reports" },
      { name: "Shipping Info", href: "/shipping" },
      { name: "Contact", href: "/contact" },
    ],
    Support: [
      { name: "FAQ", href: "/faq" },
      { name: "Order Tracking", href: "/tracking" },
      { name: "Returns", href: "/returns" },
      { name: "Research Resources", href: "/resources" },
    ],
    Legal: [
      { name: "Terms of Service", href: "/terms" },
      { name: "Privacy Policy", href: "/privacy" },
      { name: "Research Disclaimer", href: "/disclaimer" },
    ],
  };

  return (
    <footer id="contact" className="bg-neutral-950 text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16 sm:py-20">
        <div className="grid lg:grid-cols-6 gap-12 lg:gap-8">
          {/* Brand Column */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-6">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl" />
                <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
                  A
                </span>
              </div>
              <span className="text-xl font-semibold tracking-tight">
                Aminocan
              </span>
            </Link>
            <p className="text-neutral-400 leading-relaxed mb-6 max-w-xs">
              Premium research peptides with uncompromising quality standards.
              Trusted by researchers worldwide.
            </p>
            <div className="space-y-3">
              <a
                href="mailto:support@aminocan.com"
                className="flex items-center gap-3 text-neutral-400 hover:text-white transition-colors"
              >
                <Mail className="w-4 h-4" />
                <span className="text-sm">support@aminocan.com</span>
              </a>
              <a
                href="https://chat.whatsapp.com/DPYUObtP3XkGly20Bku9Lk"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-neutral-400 hover:text-white transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="text-sm">Contact us on WhatsApp</span>
              </a>
              <div className="flex items-center gap-3 text-neutral-400">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">Worldwide Shipping</span>
              </div>
            </div>
          </div>

          {/* Links Columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-sm text-neutral-400 hover:text-white transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-neutral-800">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-neutral-500">
              &copy; {new Date().getFullYear()} Aminocan. All rights reserved.
            </p>
            <p className="text-xs text-neutral-600 text-center sm:text-right max-w-md">
              For research purposes only. Not intended for human consumption.
              All products are sold as research chemicals only.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
