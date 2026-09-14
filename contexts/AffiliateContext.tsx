'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Affiliate } from '@/lib/supabase';

interface AffiliateContextType {
  affiliate: Affiliate | null;
  isLoading: boolean;
  login: (affiliate: Affiliate) => void;
  logout: () => void;
  updateAffiliateData: (affiliate: Affiliate) => void;
}

const AffiliateContext = createContext<AffiliateContextType | undefined>(undefined);

const STORAGE_KEY = 'northern_peptides_affiliate';

export function AffiliateProvider({ children }: { children: React.ReactNode }) {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load affiliate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setAffiliate(parsed);
      }
    } catch (error) {
      console.error('Error loading affiliate session:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = (affiliateData: Affiliate) => {
    setAffiliate(affiliateData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(affiliateData));
  };

  const logout = () => {
    setAffiliate(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const updateAffiliateData = (affiliateData: Affiliate) => {
    setAffiliate(affiliateData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(affiliateData));
  };

  return (
    <AffiliateContext.Provider
      value={{
        affiliate,
        isLoading,
        login,
        logout,
        updateAffiliateData,
      }}
    >
      {children}
    </AffiliateContext.Provider>
  );
}

export function useAffiliate() {
  const context = useContext(AffiliateContext);
  if (context === undefined) {
    throw new Error('useAffiliate must be used within AffiliateProvider');
  }
  return context;
}
