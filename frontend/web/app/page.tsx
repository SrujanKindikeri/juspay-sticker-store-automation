'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { StoreNavbar } from '../components/store/StoreNavbar';
import { HeroBanner } from '../components/store/HeroBanner';
import { CategoryPills } from '../components/store/CategoryPills';
import { ProductCard } from '../components/store/ProductCard';
import { StoreFooter } from '../components/store/StoreFooter';
import { StickerProduct } from '../context/CartContext';

export default function StoreHomePage() {
  const router = useRouter();
  const [featuredProducts, setFeaturedProducts] = useState<StickerProduct[]>([]);
  const [bestSellers, setBestSellers] = useState<StickerProduct[]>([]);
  const [newArrivals, setNewArrivals] = useState<StickerProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  useEffect(() => {
    // Backward compatibility: If an external test or link navigates to /?order_id=...
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('order_id') && !params.has('store')) {
        router.replace(`/payment?${params.toString()}`);
        return;
      }
    }

    const fetchProducts = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/store/products?limit=50`);
        if (res.ok) {
          const data = await res.json();
          const items: StickerProduct[] = data.items || [];
          setFeaturedProducts(items.filter((p) => p.is_featured));
          setBestSellers(items.filter((p) => p.is_best_seller));
          setNewArrivals(items.filter((p) => p.is_new_arrival));
        }
      } catch (err) {
        console.error('Failed to load store products', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [apiUrl, router]);

  return (
    <div className="store-page-root" data-testid="store-homepage">
      <StoreNavbar />
      <HeroBanner />
      <CategoryPills activeCategory="all" />

      <main className="store-main-content">
        {/* Featured Stickers */}
        <section className="store-section" data-testid="featured-section">
          <div className="section-header">
            <h2 className="section-title">⭐ Featured Stickers</h2>
            <p className="section-subtitle">Staff picks and trending artist collaborations</p>
          </div>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>Loading stickers...</div>
          ) : (
            <div className="products-grid" data-testid="featured-products-grid">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>

        {/* Best Sellers */}
        <section className="store-section" data-testid="best-sellers-section">
          <div className="section-header">
            <h2 className="section-title">🔥 Best Sellers</h2>
            <p className="section-subtitle">Top customer favorites this week</p>
          </div>
          <div className="products-grid" data-testid="best-sellers-grid">
            {bestSellers.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        {/* New Arrivals */}
        <section className="store-section" data-testid="new-arrivals-section">
          <div className="section-header">
            <h2 className="section-title">🚀 Fresh New Arrivals</h2>
            <p className="section-subtitle">Brand new die-cut drops hot off the press</p>
          </div>
          <div className="products-grid" data-testid="new-arrivals-grid">
            {newArrivals.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      </main>

      <StoreFooter />
    </div>
  );
}
