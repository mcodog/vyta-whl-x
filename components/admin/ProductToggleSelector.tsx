'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
}

interface ProductToggleSelectorProps {
  products: Product[];
  selectedId: string;
  onChange: (productId: string) => void;
  disabled?: boolean;
}

export default function ProductToggleSelector({
  products,
  selectedId,
  onChange,
  disabled = false,
}: ProductToggleSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          disabled={disabled}
          className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-ink placeholder-ink-muted text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Product Grid */}
      <div className="max-h-64 overflow-y-auto border border-line rounded-lg">
        {filteredProducts.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            No products found
          </div>
        ) : (
          <div className="divide-y divide-line">
            {filteredProducts.map((product) => {
              const isSelected = selectedId === product.id;
              return (
                <button
                  key={product.id}
                  onClick={() => !disabled && onChange(product.id)}
                  disabled={disabled}
                  className={`w-full px-4 py-3 text-left transition-all ${
                    isSelected
                      ? 'bg-bronze/10 border-l-2 border-l-bronze'
                      : 'hover:bg-surface border-l-2 border-l-transparent'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${
                          isSelected ? 'text-bronze' : 'text-ink'
                        }`}
                      >
                        {product.name}
                      </div>
                    </div>
                    <div
                      className={`ml-3 text-sm font-semibold tabular-nums ${
                        isSelected ? 'text-bronze' : 'text-ink-muted'
                      }`}
                    >
                      ${product.price.toFixed(2)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Info */}
      {selectedId && (
        <div className="text-xs text-ink-muted">
          {products.find((p) => p.id === selectedId) && (
            <span>
              Selected: <span className="font-medium text-ink">
                {products.find((p) => p.id === selectedId)!.name}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
