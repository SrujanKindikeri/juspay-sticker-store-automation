'use client';

import React from 'react';
import Link from 'next/link';

interface CategoryPillsProps {
  activeCategory?: string;
}

export const CategoryPills: React.FC<CategoryPillsProps> = ({ activeCategory = 'all' }) => {
  const categories = [
    { slug: 'all', name: '✨ All Stickers', icon: '✨' },
    { slug: 'laptop', name: '💻 Laptop & Tech', icon: '💻' },
    { slug: 'anime', name: '🎌 Anime & Manga', icon: '🎌' },
    { slug: 'cute', name: '🧸 Cute & Kawaii', icon: '🧸' },
    { slug: 'gaming', name: '🎮 Gaming & Esports', icon: '🎮' },
    { slug: 'aesthetic', name: '✨ Aesthetic & Retro', icon: '✨' },
    { slug: 'quotes', name: '💬 Quotes & Dev', icon: '💬' },
    { slug: 'packs', name: '📦 Value Packs', icon: '📦' },
  ];

  return (
    <div className="category-pills-bar" data-testid="category-pills-bar">
      <div className="category-pills-scroll">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.slug;
          return (
            <Link
              key={cat.slug}
              href={cat.slug === 'all' ? '/products' : `/products?category=${cat.slug}`}
              className={`category-pill ${isActive ? 'active' : ''}`}
              data-testid={`category-pill-${cat.slug}`}
            >
              <span>{cat.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
