'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Mail, MessageSquare, Clock, MapPin, Beaker, ShieldCheck, Send } from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

export default function ContactPage() {
  const whatsappNumber = '+16473029495';
  const whatsappMessage = encodeURIComponent('Hi! I have a question about your research peptides.');
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero Section */}
      <section className="relative bg-white border-b border-line overflow-hidden">
        {/* Molecular grid pattern */}
        <div className="absolute inset-0 opacity-[0.02]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="molecular-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="#1A1A1A" />
                <circle cx="0" cy="0" r="1" fill="#1A1A1A" />
                <circle cx="60" cy="0" r="1" fill="#1A1A1A" />
                <circle cx="0" cy="60" r="1" fill="#1A1A1A" />
                <circle cx="60" cy="60" r="1" fill="#1A1A1A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#molecular-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-32 sm:pt-44 pb-12 sm:pb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-2xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/10 border border-bronze/20 rounded-full mb-4">
              <Beaker className="w-3.5 h-3.5 text-bronze" />
              <span className="text-xs font-medium text-bronze">Research Support Team</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight text-ink">
              Contact Us
            </h1>
            <p className="text-base sm:text-lg text-ink-muted">
              Have questions about our research compounds? Our dedicated support team is here to assist you with product inquiries, orders, and technical questions.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="py-12 sm:py-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6 mb-10 sm:mb-16">
            {/* WhatsApp Card */}
            <motion.a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="group relative bg-white rounded-2xl border border-line p-5 sm:p-8 hover:shadow-xl hover:shadow-ink/5 hover:border-ink/20 transition-all"
            >
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-green-500/10 rounded-2xl flex items-center justify-center group-hover:bg-green-500/20 transition-colors flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="w-7 h-7 text-green-600 fill-current">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg sm:text-xl font-bold text-ink">WhatsApp</h3>
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold rounded-full uppercase">Fastest</span>
                  </div>
                  <p className="text-ink-muted mb-4 text-sm">
                    Get instant responses to your questions. Our team is available to chat during business hours.
                  </p>
                  <p className="text-base sm:text-lg font-semibold text-ink break-words">+1 (647) 302-9495</p>
                </div>
              </div>
              <div className="absolute top-4 right-4">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
            </motion.a>

            {/* Email Card */}
            <motion.a
              href="mailto:support@aminocan.com"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="group relative bg-white rounded-2xl border border-line p-5 sm:p-8 hover:shadow-xl hover:shadow-ink/5 hover:border-ink/20 transition-all"
            >
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-bronze/10 rounded-2xl flex items-center justify-center group-hover:bg-bronze/20 transition-colors flex-shrink-0">
                  <Mail className="w-7 h-7 text-bronze" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-xl font-bold text-ink mb-2">Email Support</h3>
                  <p className="text-ink-muted mb-4 text-sm">
                    For detailed inquiries, order issues, or documentation requests. We respond within 24 hours.
                  </p>
                  <p className="text-base sm:text-lg font-semibold text-bronze break-words">support@aminocan.com</p>
                </div>
              </div>
            </motion.a>
          </div>

          {/* Info Cards */}
          <div className="grid sm:grid-cols-3 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-surface rounded-2xl p-6 border border-line"
            >
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-4 border border-line">
                <Clock className="w-6 h-6 text-bronze" />
              </div>
              <h4 className="font-semibold text-ink mb-2">Business Hours</h4>
              <p className="text-sm text-ink-muted">
                Monday - Friday<br />
                9:00 AM - 6:00 PM EST
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-surface rounded-2xl p-6 border border-line"
            >
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-4 border border-line">
                <MessageSquare className="w-6 h-6 text-bronze" />
              </div>
              <h4 className="font-semibold text-ink mb-2">Response Time</h4>
              <p className="text-sm text-ink-muted">
                WhatsApp: Within hours<br />
                Email: Within 24 hours
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-surface rounded-2xl p-6 border border-line"
            >
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-4 border border-line">
                <MapPin className="w-6 h-6 text-bronze" />
              </div>
              <h4 className="font-semibold text-ink mb-2">Shipping Region</h4>
              <p className="text-sm text-ink-muted">
                Currently shipping<br />
                to Canada only
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 sm:py-20 bg-surface">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 lg:px-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-3">
              Frequently Asked Questions
            </h2>
            <p className="text-ink-muted">
              Quick answers to common inquiries
            </p>
          </motion.div>

          <div className="space-y-4">
            {[
              {
                q: 'What are your shipping times?',
                a: 'Orders are processed same-day if placed before 2 PM EST. Standard shipping within Canada takes 2-5 business days. Express shipping options are available at checkout.'
              },
              {
                q: 'Do you provide Certificates of Analysis?',
                a: 'Yes, every product includes a Certificate of Analysis (COA) from third-party HPLC testing. COAs are available for download on each product page.'
              },
              {
                q: 'What payment methods do you accept?',
                a: 'We accept Interac e-Transfer and cryptocurrency payments (Bitcoin, Ethereum, USDT) for your convenience and privacy.'
              },
              {
                q: 'Are your peptides research-grade?',
                a: 'All our peptides are pharmaceutical-grade with 99%+ purity, verified through independent HPLC and Mass Spectrometry analysis. They are intended for research purposes only.'
              },
            ].map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-xl p-6 border border-line"
              >
                <h4 className="font-semibold text-ink mb-2">{faq.q}</h4>
                <p className="text-sm text-ink-muted leading-relaxed">{faq.a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="bg-ink rounded-2xl sm:rounded-3xl p-6 sm:p-12 text-center">
            <div className="max-w-2xl mx-auto">
              <div className="w-16 h-16 bg-bronze/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="w-8 h-8 text-bronze" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                Quality You Can Trust
              </h2>
              <p className="text-white/60 mb-8">
                Every compound is third-party tested for purity and potency. We're committed to providing researchers with the highest quality peptides available.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white hover:bg-white/90 text-ink font-semibold rounded-xl transition-all"
                >
                  <Send className="w-4 h-4" />
                  Message Us on WhatsApp
                </a>
                <a
                  href="mailto:support@aminocan.com"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all border border-white/10"
                >
                  <Mail className="w-4 h-4" />
                  Send an Email
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
