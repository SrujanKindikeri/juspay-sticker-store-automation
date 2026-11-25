'use client';

import React from 'react';
import Link from 'next/link';

export const StoreFooter: React.FC = () => {
  return (
    <footer className="store-footer" data-testid="store-footer">
      <div className="footer-container">
        <div className="footer-col brand">
          <div className="store-logo footer-logo">
            <span className="logo-sparkle">✦</span>
            <span className="logo-brand">Stickora</span>
            <span className="logo-badge">Premium Vinyl Stickers</span>
          </div>
          <p className="footer-description">
            Stickora is your destination for precision laser die-cut, waterproof vinyl stickers.
            Designed with care for laptops, bottles, studios, and creative setups.
          </p>
          <div className="footer-guarantee">
            <span>🛡️ 100% Quality Guaranteed</span>
            <span>💧 Waterproof &amp; UV Safe</span>
          </div>
        </div>

        <div className="footer-col">
          <h4>Explore Stickora</h4>
          <ul>
            <li><Link href="/products">All Stickers</Link></li>
            <li><Link href="/products?category=laptop">Laptop &amp; Tech</Link></li>
            <li><Link href="/products?category=anime">Anime &amp; Manga</Link></li>
            <li><Link href="/products?category=gaming">Gaming Gear</Link></li>
            <li><Link href="/products?category=packs">Sticker Bundles</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Customer Care</h4>
          <ul>
            <li><Link href="/cart">Shopping Cart</Link></li>
            <li><Link href="/checkout">Shipping &amp; Delivery</Link></li>
            <li><span>Express Dispatch in 24h</span></li>
            <li><span>Returns &amp; Replacements</span></li>
            <li><Link href="/payment">JUSPAY Gateway Demo</Link></li>
          </ul>
        </div>

        <div className="footer-col contact">
          <h4>Store Information</h4>
          <p>📍 Stickora Studio Headquarters</p>
          <p>Koramangala, Bengaluru, Karnataka 560095</p>
          <p>✉️ Email: <code>hello@stickora.demo</code></p>
          <p>📞 Phone: <code>+91 80 4000 8921</code></p>
          <div className="footer-tagline">
            Educational payment simulation — no real money transferred.
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© 2026 Stickora — Premium Vinyl Stickers. All rights reserved.</p>
        <div className="footer-bottom-links">
          <span>Privacy Policy</span>
          <span>Terms of Service</span>
          <span>Delivery Information</span>
        </div>
      </div>
    </footer>
  );
};
