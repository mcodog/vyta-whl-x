'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight,
  FileCheck,
  FlaskConical,
  MapPin,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react';

// Muted "lab monitor" loop. Hosted on public Supabase Storage; swap for any
// public HTTPS URL. When empty the panel runs the chromatogram indefinitely.
const LAB_VIDEO_URL =
  'https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/products/Multi-Shot_Video_-_Extreme_macro_on_a_dark_laboratory_monitor_a_thin_glowing_bronze-gold_line_slowly.mp4';

// The "one clean peak" HPLC trace: flat baseline with faint blips, one sharp
// peak right-of-center — the visual shape of a 99%+ purity claim.
const TRACE_D =
  'M 0 380 L 110 380 L 126 373 L 142 380 L 250 380 L 262 376 L 274 380 L 452 380 ' +
  'C 478 380 492 74 512 74 C 532 74 546 380 572 380 L 640 380 L 652 375 L 664 380 L 800 380';

const pillars = [
  {
    icon: ShieldCheck,
    title: 'Independent Lab Tested',
    description:
      'Every compound is HPLC-UV purity tested by an accredited third-party lab, PPB Analytical Inc.',
  },
  {
    icon: FileCheck,
    title: 'COA on Every Order',
    description:
      'A Certificate of Analysis backs each product — browse and verify the reports before you buy.',
  },
  {
    icon: MapPin,
    title: 'Canadian Supplier',
    description:
      'Sourced and shipped from Canada, with documentation you can actually inspect.',
  },
];

// Grid lines for the chromatogram backdrop.
const V_GRID = [80, 160, 240, 320, 400, 480, 560, 640, 720];
const H_GRID = [75, 150, 225, 300, 375];

export default function LabResultsShowcase() {
  const prefersReducedMotion = useReducedMotion();
  const [allowVideo, setAllowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Persists a manual pause across scroll-out / scroll-in.
  const userPausedRef = useRef(false);

  // Only mount the video on wider viewports, and never under reduced motion —
  // phones and reduced-motion users stay on the animated chromatogram.
  useEffect(() => {
    if (!LAB_VIDEO_URL || prefersReducedMotion) {
      setAllowVideo(false);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setAllowVideo(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefersReducedMotion]);

  // Play only while the panel is on screen. Combined with preload="none", the
  // clip costs zero bytes until the user actually scrolls here.
  useEffect(() => {
    if (!allowVideo) return;
    const panel = panelRef.current;
    const video = videoRef.current;
    if (!panel || !video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!userPausedRef.current) {
            video.play().catch(() => {});
            setVideoPlaying(true);
          }
        } else {
          video.pause();
          setVideoPlaying(false);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [allowVideo]);

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (videoPlaying) {
      video.pause();
      setVideoPlaying(false);
      userPausedRef.current = true;
    } else {
      userPausedRef.current = false;
      video.play().catch(() => {});
      setVideoPlaying(true);
    }
  };

  return (
    <section
      id="lab-results"
      className="relative py-16 sm:py-24 bg-ink text-white scroll-mt-[104px] overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left column — the argument */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/20 border border-bronze/30 rounded-full mb-4">
              <FlaskConical className="w-3.5 h-3.5 text-bronze" />
              <span className="text-xs font-medium text-bronze">Third-Party Verified</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-bold mb-4 leading-tight">
              We Show Our Work
            </h2>

            <p className="text-white/60 leading-relaxed">
              Anyone can claim 99% purity. We publish the third-party HPLC reports
              behind every batch — so you can check the numbers yourself before you
              buy.
            </p>

            {/* Pillars */}
            <div className="mt-8 sm:mt-10 space-y-5">
              {pillars.map((pillar, index) => (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-3.5"
                >
                  <div className="w-11 h-11 bg-bronze/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <pillar.icon className="w-5 h-5 text-bronze" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-base mb-0.5">
                      {pillar.title}
                    </h3>
                    <p className="text-sm text-white/60 leading-relaxed">
                      {pillar.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* CTA */}
            <div className="mt-10">
              <Link
                href="/lab-results"
                className="inline-flex items-center gap-2 px-6 py-3 bg-bronze hover:bg-bronze-light text-ink font-semibold rounded-xl transition-colors"
              >
                Explore Lab Results
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>

          {/* Right column — the exhibit panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            {/* Bronze corner ticks */}
            <div
              aria-hidden="true"
              className="absolute -top-2 -left-2 w-5 h-5 border-t-2 border-l-2 border-bronze/50 rounded-tl-sm"
            />
            <div
              aria-hidden="true"
              className="absolute -top-2 -right-2 w-5 h-5 border-t-2 border-r-2 border-bronze/50 rounded-tr-sm"
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-2 -left-2 w-5 h-5 border-b-2 border-l-2 border-bronze/50 rounded-bl-sm"
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-2 -right-2 w-5 h-5 border-b-2 border-r-2 border-bronze/50 rounded-br-sm"
            />

            {/* Panel */}
            <div
              ref={panelRef}
              className="relative rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
            >
              <Link
                href="/lab-results"
                aria-label="Explore lab results"
                className="group block"
              >
                <div className="relative aspect-video overflow-hidden">
                  {/* Chromatogram — the instant-on / restore state */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 800 450"
                    preserveAspectRatio="xMidYMid slice"
                    className="absolute inset-0 w-full h-full"
                  >
                    {V_GRID.map((x) => (
                      <line
                        key={`v${x}`}
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={450}
                        stroke="white"
                        strokeOpacity="0.04"
                      />
                    ))}
                    {H_GRID.map((y) => (
                      <line
                        key={`h${y}`}
                        x1={0}
                        y1={y}
                        x2={800}
                        y2={y}
                        stroke="white"
                        strokeOpacity="0.04"
                      />
                    ))}
                    <line
                      x1={0}
                      y1={382}
                      x2={800}
                      y2={382}
                      stroke="white"
                      strokeOpacity="0.08"
                    />
                    {/* Glow underlay */}
                    <path
                      d={TRACE_D}
                      pathLength={1}
                      fill="none"
                      stroke="#B8A876"
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-chromatogram opacity-30 blur-[4px]"
                    />
                    {/* Main trace */}
                    <path
                      d={TRACE_D}
                      pathLength={1}
                      fill="none"
                      stroke="#9C8B5A"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-chromatogram"
                    />
                  </svg>

                  {/* Video — crossfades over the SVG once it starts playing */}
                  {allowVideo && (
                    <video
                      ref={(el) => {
                        videoRef.current = el;
                        // React can drop `muted` from SSR markup — set it here too.
                        if (el) el.muted = true;
                      }}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
                        videoReady ? 'opacity-100' : 'opacity-0'
                      }`}
                      src={LAB_VIDEO_URL}
                      muted
                      loop
                      playsInline
                      preload="none"
                      tabIndex={-1}
                      onPlaying={() => setVideoReady(true)}
                    />
                  )}

                  {/* Hover wash */}
                  <div className="absolute inset-0 bg-bronze/0 group-hover:bg-bronze/5 transition-colors" />
                </div>
              </Link>

              {/* Pause / play — sibling of the Link, never nested inside it */}
              {allowVideo && videoReady && (
                <button
                  type="button"
                  onClick={toggleVideo}
                  aria-label={videoPlaying ? 'Pause lab video' : 'Play lab video'}
                  className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-ink/50 hover:bg-ink/70 border border-white/20 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center transition-colors"
                >
                  {videoPlaying ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3 ml-0.5" />
                  )}
                </button>
              )}

              {/* Caption bar — styled like an exhibit label */}
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-white/10 bg-white/[0.04]">
                <span className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-white/50">
                  <FlaskConical className="w-3.5 h-3.5 text-bronze" />
                  HPLC-UV · PPB Analytical Inc.
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-bronze-light tabular-nums whitespace-nowrap">
                  99%+ Verified
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
