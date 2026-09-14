'use client';

import Navigation from '@/components/Navigation';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import Products from '@/components/Products';
import LabResultsShowcase from '@/components/LabResultsShowcase';
import Footer from '@/components/Footer';

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navigation />
      <Hero />
      <Products />
      <LabResultsShowcase />
      <Features />
      <Footer />
    </main>
  );
}
