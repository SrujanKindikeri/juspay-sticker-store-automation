'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { StickerProduct, useCart } from '../../context/CartContext';

interface ProductCardProps {
  product: StickerProduct;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { addItem } = useCart();
  const [added, setAdded] = useState<boolean>(false);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addItem(product, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  };

  return (
    <div className="product-card" data-testid={`product-card-${product.id}`}>
      <Link href={`/products/${product.id}`} className="product-card-link">
        {/* Badges */}
        <div className="product-badges">
          {product.is_best_seller && <span className="badge best-seller">BEST SELLER</span>}
          {product.is_featured && <span className="badge featured">FEATURED</span>}
          {product.is_new_arrival && <span className="badge new">NEW</span>}
        </div>

        {/* Thumbnail Preview */}
        <div className="product-img-wrapper">
          <img src={product.image_url} alt={product.name} className="product-img" />
        </div>

        {/* Info */}
        <div className="product-info">
          <div className="product-category-tag">{product.category.toUpperCase()}</div>
          <h3 className="product-name" title={product.name}>{product.name}</h3>
          
          <div className="product-specs">
            <span>📏 {product.size}</span>
            <span>✨ {product.material}</span>
          </div>

          <div className="product-meta-row">
            <div className="product-rating">
              <span className="star">★</span>
              <span className="rating-score">{product.rating.toFixed(1)}</span>
              <span className="review-count">({product.review_count})</span>
            </div>
            <div className="product-stock-tag">
              {product.stock_quantity > 0 ? (
                <span className="in-stock">In Stock</span>
              ) : (
                <span className="out-of-stock">Out of Stock</span>
              )}
            </div>
          </div>

          <div className="product-footer-row">
            <div className="product-price">
              <span className="currency-symbol">₹</span>
              <span className="price-amount">{product.price.toFixed(2)}</span>
            </div>

            <button
              type="button"
              className={`add-to-cart-btn ${added ? 'added' : ''}`}
              onClick={handleAddToCart}
              disabled={product.stock_quantity <= 0}
              data-testid={`add-to-cart-btn-${product.id}`}
            >
              {added ? '✓ Added' : 'Add to Cart +'}
            </button>
          </div>
        </div>
      </Link>
    </div>
  );
};
