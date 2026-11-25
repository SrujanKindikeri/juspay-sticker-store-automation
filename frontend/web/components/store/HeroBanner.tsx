'use client';

import React from 'react';
import Link from 'next/link';

export const HeroBanner: React.FC = () => {
  return (
    <section className="store-hero" data-testid="hero-banner">
      <div className="hero-content">
        <div className="hero-tag-badge">✦ STICKORA · PREMIUM VINYL STICKERS</div>
        <h1 className="hero-title">
          Stickora — Premium Vinyl Stickers Crafted For Your Gear
        </h1>
        <p className="hero-subtitle">
          Elevate your MacBook, bottle, phone, and workspace with precision laser die-cut vinyl art.
          Waterproof, UV-resistant, and zero-residue finish.
        </p>
        <div className="hero-perks">
          <span className="hero-perk-item">💧 100% Waterproof</span>
          <span className="hero-perk-item">🛡️ Scratch Resistant</span>
          <span className="hero-perk-item">🚚 Free Delivery &gt; ₹499</span>
          <span className="hero-perk-item">🇮🇳 Made in India</span>
        </div>
        <div className="hero-cta-group">
          <Link href="/products" className="hero-btn-primary" data-testid="hero-shop-all-btn">
            Explore All Stickers →
          </Link>
          <Link href="/products?category=packs" className="hero-btn-secondary" data-testid="hero-packs-btn">
            📦 Browse Sticker Packs
          </Link>
        </div>
      </div>
      <div className="hero-visual">
        <div className="hero-sticker-cluster">
          <img src="/stickers/cyberpunk-cat.svg" alt="Cyberpunk Cat" className="cluster-img cat" />
          <img src="/stickers/coffee-code.svg" alt="Coffee and Code" className="cluster-img coffee" />
          <img src="/stickers/matcha-bear.svg" alt="Matcha Boba Bear" className="cluster-img bear" />
          <img src="/stickers/pixel-dragon.svg" alt="Pixel Dragon" className="cluster-img dragon" />
        </div>
      </div>
    </section>
  );
};
