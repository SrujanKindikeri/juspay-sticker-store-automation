'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoreNavbar } from '../../components/store/StoreNavbar';
import { CategoryPills } from '../../components/store/CategoryPills';
import { ProductCard } from '../../components/store/ProductCard';
import { StoreFooter } from '../../components/store/StoreFooter';
import { StickerProduct } from '../../context/CartContext';

function ProductsContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category') || 'all';
  const searchParam = searchParams.get('search') || '';

  const [products, setProducts] = useState<StickerProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortBy, setSortBy] = useState<string>('featured');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  useEffect(() => {
    const fetchCatalog = async () => {
      setLoading(true);
      try {
        let url = `${apiUrl}/api/v1/store/products?limit=100`;
        if (categoryParam && categoryParam !== 'all') {
          url += `&category=${encodeURIComponent(categoryParam)}`;
        }
        if (searchParam) {
          url += `&search=${encodeURIComponent(searchParam)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          let items: StickerProduct[] = data.items || [];
          setProducts(items);
        }
      } catch (err) {
        console.error('Failed to fetch catalogue', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCatalog();
  }, [categoryParam, searchParam, apiUrl]);

  const sortedProducts = [...products].sort((a, b) => {
    if (sortBy === 'price_asc') return a.price - b.price;
    if (sortBy === 'price_desc') return b.price - a.price;
    if (sortBy === 'rating') return b.rating - a.rating;
    return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0);
  });

  return (
    <div className="store-page-root" data-testid="products-catalogue-page">
      <StoreNavbar />
      <CategoryPills activeCategory={categoryParam} />

      <main className="store-section" style={{ minHeight: '60vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 className="section-title catalogue-heading" data-testid="catalogue-heading">
              {searchParam ? `Results for "${searchParam}"` : categoryParam !== 'all' ? `${categoryParam.toUpperCase()} STICKERS` : 'ALL STICKERS'}
            </h1>
            <p className="section-subtitle">
              Showing {sortedProducts.length} premium physical die-cut sticker{sortedProducts.length === 1 ? '' : 's'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <label htmlFor="sort-select" style={{ fontSize: '0.88rem', fontWeight: 600, color: '#475569' }}>Sort by:</label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ padding: '0.45rem 0.85rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem', outline: 'none' }}
              data-testid="sort-select"
            >
              <option value="featured">Featured First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            Loading catalogue stickers...
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="empty-cart-card" data-testid="empty-search-state">
            <div className="empty-cart-icon">🔍</div>
            <h3>No stickers found matching your criteria</h3>
            <p style={{ color: '#64748b', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
              Try searching for a different keyword or explore other categories.
            </p>
            <a href="/products" className="hero-btn-primary" style={{ display: 'inline-block' }}>
              View All Stickers
            </a>
          </div>
        ) : (
          <div className="products-grid" data-testid="products-grid">
            {sortedProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center' }}>Loading products...</div>}>
      <ProductsContent />
    </Suspense>
  );
}
