'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/lib/supabase';

interface CustomerContextType {
  customer: Customer | null;
  isLoading: boolean;
  refreshCustomer: () => Promise<void>;
  logout: () => Promise<void>;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

async function fetchCustomer(): Promise<Customer | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const res = await fetch('/api/auth/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session.access_token }),
  });
  if (!res.ok) return null;
  const { customer } = await res.json();
  return customer ?? null;
}

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCustomer = async () => {
    try {
      setCustomer(await fetchCustomer());
    } catch (e) {
      console.error('Error loading customer:', e);
      setCustomer(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Never await Supabase calls inside onAuthStateChange — it holds an
    // internal lock and other supabase requests will deadlock. Defer with
    // setTimeout so the callback returns immediately.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setCustomer(null);
        setIsLoading(false);
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        setTimeout(() => { void refreshCustomer(); }, 0);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setCustomer(null);
  };

  return (
    <CustomerContext.Provider value={{ customer, isLoading, refreshCustomer, logout }}>
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error('useCustomer must be used within a CustomerProvider');
  }
  return context;
}
