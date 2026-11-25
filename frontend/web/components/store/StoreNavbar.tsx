'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '../../context/CartContext';

export const StoreNavbar: React.FC = () => {
  const router = useRouter();
  const { totalCount } = useCart();
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push('/products');
    }
  };

  return (
    <header className="store-header" data-testid="store-header">
      {/* Top utility alert bar */}
      <div className="store-top-bar" style={{ justifyContent: 'center' }}>
        <span>✨ Stickora · Premium Vinyl Stickers · Free Express Delivery above ₹499</span>
      </div>

      {/* Main navigation */}
      <nav className="store-nav">
        <div className="store-nav-container">
          {/* Logo */}
          <Link href="/" className="store-logo" data-testid="store-logo">
            <span className="logo-sparkle">✦</span>
            <span className="logo-brand">Stickora</span>
            <span className="logo-badge">Premium Vinyl Stickers</span>
          </Link>

          {/* Search Form */}
          <form className="store-search-form" onSubmit={handleSearchSubmit} data-testid="store-search-form">
            <input
              type="text"
              aria-label="Search stickers"
              placeholder="Search anime, tech, gaming, aesthetic stickers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="store-search-input"
              data-testid="store-search-input"
            />
            <button type="submit" aria-label="Search" className="store-search-button" data-testid="store-search-button">
              🔍
            </button>
          </form>

          {/* Nav Links & Cart */}
          <div className="store-nav-actions">
            <Link href="/products" className="store-nav-link" data-testid="nav-products-link">
              All Stickers
            </Link>
            <Link href="/products?category=laptop" className="store-nav-link">
              Laptop
            </Link>
            <Link href="/products?category=anime" className="store-nav-link">
              Anime
            </Link>
            <Link href="/products?category=gaming" className="store-nav-link">
              Gaming
            </Link>

            {/* Shopping Cart Button */}
            <Link href="/cart" className="store-cart-button" data-testid="nav-cart-button">
              <span className="cart-icon">🛒</span>
              <span className="cart-label">Cart</span>
              <span className="cart-count-badge" data-testid="cart-count-badge">
                {totalCount}
              </span>
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
};
