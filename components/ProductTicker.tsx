'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
}

export default function ProductTicker() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    async function fetchTopProducts() {
      const { data } = await supabase
        .from('products')
        .select('id, name, slug, price')
        .eq('active', true)
        .limit(10);

      if (data) {
        setProducts([...data, ...data]);
      }
    }
    fetchTopProducts();
  }, []);

  if (products.length === 0) return null;

  return (
    <div className="bg-gray-900 border-t border-white/[0.06] overflow-hidden">
      <div className="relative py-2.5">
        <div className="flex animate-ticker whitespace-nowrap">
          {products.map((product, index) => (
            <Link
              key={`${product.id}-${index}`}
              href={`/products/${product.slug}`}
              className="inline-flex items-center mx-8 text-white/60 hover:text-white transition-colors group"
            >
              <span className="w-1 h-1 bg-primary-400 rounded-full mr-2"></span>
              <span className="text-sm font-medium">{product.name}</span>
              <span className="text-sm ml-2 text-white/40 group-hover:text-primary-400 transition-colors tabular-nums">
                ${product.price.toFixed(2)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
