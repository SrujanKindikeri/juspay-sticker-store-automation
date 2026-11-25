'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { StoreNavbar } from '@/components/store/StoreNavbar';
import { StoreFooter } from '@/components/store/StoreFooter';
import { useCart } from '@/context/CartContext';

export default function CartPage() {
  const {
    items,
    removeItem,
    updateQuantity,
    clearCart,
    totalCount,
    subtotal,
    deliveryFee,
    totalAmount,
    freeShippingThreshold,
    freeShippingRemaining,
  } = useCart();

  const progressPercent = Math.min(100, Math.round((subtotal / freeShippingThreshold) * 100));

  return (
    <div className="store-page">
      <StoreNavbar />

      <main className="cart-container">
        {/* Breadcrumb Navigation */}
        <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span className="crumb-sep">/</span>
          <Link href="/products">Stickers</Link>
          <span className="crumb-sep">/</span>
          <span className="current">Shopping Cart</span>
        </nav>

        {/* Page Header */}
        <div className="cart-header">
          <div className="cart-header-title-group">
            <h1 className="cart-title">Shopping Cart</h1>
            <span className="cart-count-pill">
              {totalCount} {totalCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          {items.length > 0 && (
            <button
              type="button"
              className="btn-header-clear"
              onClick={clearCart}
              data-testid="clear-cart-btn"
              title="Empty your cart"
            >
              Clear Cart
            </button>
          )}
        </div>

        {items.length === 0 ? (
          /* Empty Cart State */
          <div className="empty-cart-view" data-testid="empty-cart-container">
            <div className="empty-cart-graphic-wrapper">
              <svg
                className="empty-cart-svg"
                viewBox="0 0 200 200"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                {/* Background soft glow circle */}
                <circle cx="100" cy="100" r="88" fill="#F1F5F9" />
                <circle cx="100" cy="100" r="70" fill="#E2E8F0" opacity="0.4" />

                {/* Floating Decorative Sticker Elements */}
                {/* 1. Sparkle Top Left */}
                <path
                  d="M48 42L52 30L56 42L68 46L56 50L52 62L48 50L36 46L48 42Z"
                  fill="#F59E0B"
                  opacity="0.85"
                />
                {/* 2. Heart Top Right */}
                <path
                  d="M152 46C148 41 140 42 137 47C134 42 126 41 122 46C117 52 118 61 127 69L137 78L147 69C156 61 157 52 152 46Z"
                  fill="#EC4899"
                  opacity="0.85"
                />
                {/* 3. Dev Tag Badge Bottom Left */}
                <rect x="28" y="128" width="38" height="22" rx="6" fill="#3B82F6" opacity="0.8" />
                <path d="M40 135L35 139L40 143M54 135L59 139L54 143" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* 4. Holographic Star Bottom Right */}
                <path
                  d="M158 132L162 122L166 132L176 135L166 138L162 148L158 138L148 135L158 132Z"
                  fill="#8B5CF6"
                  opacity="0.85"
                />

                {/* Modern Cart Basket Base */}
                <path
                  d="M62 68H148L136 120H74L62 68Z"
                  fill="#FFFFFF"
                  stroke="#1E293B"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
                {/* Cart Mesh Details */}
                <line x1="86" y1="74" x2="86" y2="114" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="110" y1="74" x2="110" y2="114" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="70" y1="94" x2="140" y2="94" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />

                {/* Cart Handle */}
                <path
                  d="M44 48H58L64 74"
                  stroke="#1E293B"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Cart Wheels */}
                <circle cx="82" cy="138" r="8" fill="#1E293B" />
                <circle cx="82" cy="138" r="3" fill="#FFFFFF" />
                <circle cx="128" cy="138" r="8" fill="#1E293B" />
                <circle cx="128" cy="138" r="3" fill="#FFFFFF" />

                {/* Wheel Axle */}
                <path d="M74 122L82 134M136 122L128 134" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>

            <h2 className="empty-cart-title">Your cart is waiting for something awesome!</h2>

            <p className="empty-cart-subtitle" data-testid="empty-cart-message">
              Your cart is empty. Looks like you haven&apos;t added any die-cut physical stickers to your cart yet. Explore our curated collections of waterproof vinyl stickers for laptops, mechanical keyboards, and setups!
            </p>

            <div className="empty-cart-cta-group">
              <Link
                href="/products"
                className="btn-continue-shopping"
                data-testid="continue-shopping-btn"
              >
                Browse Stickers Catalogue →
              </Link>
            </div>

            {/* Quick Explore Categories */}
            <div className="empty-cart-categories">
              <span className="categories-label">Explore popular sticker themes:</span>
              <div className="categories-pills">
                <Link href="/products?category=developer" className="empty-cat-pill">
                  💻 Developer
                </Link>
                <Link href="/products?category=cyberpunk" className="empty-cat-pill">
                  ⚡ Cyberpunk
                </Link>
                <Link href="/products?category=anime" className="empty-cat-pill">
                  🌸 Anime
                </Link>
                <Link href="/products?category=gaming" className="empty-cat-pill">
                  🎮 Gaming
                </Link>
                <Link href="/products?category=retro" className="empty-cat-pill">
                  📼 Retro
                </Link>
              </div>
            </div>
          </div>
        ) : (
          /* Active Cart Grid (Two-Column Desktop, Stacked Mobile) */
          <div className="cart-grid">
            {/* Left Column: Cart Items List */}
            <section className="cart-items-column" aria-label="Cart Items">
              {/* Free Shipping Progress Card */}
              <div className="free-shipping-card" data-testid="free-shipping-banner">
                <div className="free-shipping-header">
                  <span className="shipping-icon">{freeShippingRemaining === 0 ? '🎉' : '🚚'}</span>
                  <div className="shipping-text-block">
                    {freeShippingRemaining > 0 ? (
                      <p className="progress-text">
                        Add <strong className="highlight-price">₹{freeShippingRemaining.toFixed(2)}</strong> more to unlock <strong className="highlight-free">FREE Delivery</strong> across India!
                      </p>
                    ) : (
                      <p className="progress-text unlocked">
                        <strong>Congratulations!</strong> You have unlocked <strong>FREE Delivery</strong> across India!
                      </p>
                    )}
                  </div>
                  <span className="threshold-pill">
                    {freeShippingRemaining === 0 ? 'Unlocked' : `Threshold: ₹${freeShippingThreshold.toFixed(0)}`}
                  </span>
                </div>

                <div className="progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`progress-fill ${freeShippingRemaining === 0 ? 'fill-complete' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Items Card List */}
              <div className="cart-items-container">
                {items.map((item) => {
                  const isMaxStock = item.quantity >= item.product.stock_quantity;
                  const itemTotal = (item.product.price * item.quantity).toFixed(2);

                  return (
                    <article
                      key={item.product.id}
                      className="cart-product-card"
                      data-testid={`cart-item-${item.product.id}`}
                    >
                      {/* Product Thumbnail */}
                      <div className="cart-product-thumb">
                        <Image
                          src={item.product.image_url}
                          alt={item.product.name}
                          width={96}
                          height={96}
                          className="thumb-image"
                          style={{ objectFit: 'contain' }}
                        />
                      </div>

                      {/* Product Main Details */}
                      <div className="cart-product-details">
                        <div className="details-header">
                          <span className="product-category-tag">
                            {item.product.category.toUpperCase()}
                          </span>
                          <Link href={`/products/${item.product.id}`} className="product-name-link">
                            {item.product.name}
                          </Link>
                        </div>

                        <p className="product-spec-line">
                          <span>Size: <strong>{item.product.size}</strong></span>
                          <span className="spec-bullet">•</span>
                          <span>Material: <strong>{item.product.material}</strong></span>
                        </p>

                        <div className="product-pricing-line">
                          <span className="unit-price-label">Unit price:</span>
                          <span className="unit-price-val">₹{item.product.price.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Quantity Controls & Stepper */}
                      <div className="cart-product-controls">
                        <label className="controls-label" htmlFor={`qty-${item.product.id}`}>
                          Quantity:
                        </label>
                        <div className="stepper-wrapper">
                          <button
                            type="button"
                            className="stepper-button minus"
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            data-testid={`decrease-qty-${item.product.id}`}
                            aria-label={`Decrease quantity of ${item.product.name}`}
                          >
                            −
                          </button>
                          <span
                            id={`qty-${item.product.id}`}
                            className="stepper-display"
                            data-testid={`item-qty-${item.product.id}`}
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="stepper-button plus"
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                            disabled={isMaxStock}
                            data-testid={`increase-qty-${item.product.id}`}
                            aria-label={`Increase quantity of ${item.product.name}`}
                          >
                            +
                          </button>
                        </div>

                        {isMaxStock ? (
                          <span className="stock-alert-pill warning">Max in stock ({item.product.stock_quantity})</span>
                        ) : (
                          <span className="stock-alert-pill in-stock">In Stock</span>
                        )}
                      </div>

                      {/* Item Total & Remove Action */}
                      <div className="cart-product-actions">
                        <div className="product-subtotal-block">
                          <span className="item-total-label">Subtotal</span>
                          <span className="item-total-amount">₹{itemTotal}</span>
                        </div>

                        <button
                          type="button"
                          className="btn-item-remove"
                          onClick={() => removeItem(item.product.id)}
                          data-testid={`remove-cart-item-${item.product.id}`}
                          title={`Remove ${item.product.name} from cart`}
                        >
                          <svg className="remove-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                          <span>Remove</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Bottom Actions Row */}
              <div className="cart-bottom-actions">
                <Link href="/products" className="btn-link-continue">
                  ← Continue Shopping
                </Link>
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={clearCart}
                  data-testid="clear-cart-btn"
                >
                  Clear Entire Cart
                </button>
              </div>
            </section>

            {/* Right Column: Sticky Order Summary */}
            <aside className="cart-summary-column" aria-label="Order Summary">
              <div className="cart-summary-sticky-card">
                <div className="summary-card-header">
                  <h2 className="summary-card-title">Order Summary</h2>
                  <span className="summary-badge">{totalCount} {totalCount === 1 ? 'item' : 'items'}</span>
                </div>

                <div className="summary-breakdown">
                  {/* Items Subtotal */}
                  <div className="summary-line-item">
                    <span className="summary-item-label">
                      Items Subtotal ({totalCount} {totalCount === 1 ? 'item' : 'items'})
                    </span>
                    <strong className="summary-item-value" data-testid="cart-subtotal">
                      ₹{subtotal.toFixed(2)}
                    </strong>
                  </div>

                  {/* Delivery Charges */}
                  <div className="summary-line-item">
                    <div className="delivery-label-group">
                      <span className="summary-item-label">Standard Delivery</span>
                      {deliveryFee === 0 ? (
                        <span className="free-shipping-tag">FREE above ₹{freeShippingThreshold.toFixed(0)}</span>
                      ) : (
                        <span className="shipping-sub-tag">Pan-India Courier</span>
                      )}
                    </div>
                    <strong
                      className={`summary-item-value ${deliveryFee === 0 ? 'val-free' : ''}`}
                      data-testid="cart-delivery-fee"
                    >
                      {deliveryFee === 0 ? 'FREE' : `₹${deliveryFee.toFixed(2)}`}
                    </strong>
                  </div>

                  {/* Discount Line (Standard) */}
                  <div className="summary-line-item discount-line">
                    <span className="summary-item-label">Promotion / Discount</span>
                    <span className="summary-item-value val-discount">
                      {deliveryFee === 0 && subtotal >= freeShippingThreshold ? '-₹50.00 (Free Delivery)' : '₹0.00'}
                    </span>
                  </div>

                  <div className="summary-card-divider" />

                  {/* Final Total Amount */}
                  <div className="summary-line-item summary-total-row">
                    <div className="total-label-block">
                      <span className="total-main-label">Total Amount</span>
                      <span className="total-sub-note">Inclusive of all taxes</span>
                    </div>
                    <strong className="summary-total-val" data-testid="cart-total">
                      ₹{totalAmount.toFixed(2)}
                    </strong>
                  </div>
                </div>

                {/* Primary Proceed to Checkout CTA */}
                <Link
                  href="/checkout"
                  className="btn-primary-checkout"
                  data-testid="proceed-to-checkout-btn"
                >
                  <span>Proceed to Checkout</span>
                  <span className="checkout-arrow">→</span>
                </Link>

                {/* Continue Shopping Link in Sidebar */}
                <div className="summary-continue-wrapper">
                  <Link href="/products" className="summary-continue-link">
                    ← Or continue browsing stickers
                  </Link>
                </div>

                {/* Trust & Guarantee Badges */}
                <div className="cart-perks-list">
                  <div className="perk-row">
                    <span className="perk-icon">🛡️</span>
                    <div className="perk-details">
                      <strong>100% Waterproof Vinyl</strong>
                      <p>UV-resistant, scratch-proof & leaves zero residue.</p>
                    </div>
                  </div>
                  <div className="perk-row">
                    <span className="perk-icon">📦</span>
                    <div className="perk-details">
                      <strong>Rigid Kraft Packaging</strong>
                      <p>Dispatched flat in sturdy unbendable mailers.</p>
                    </div>
                  </div>
                  <div className="perk-row">
                    <span className="perk-icon">🔒</span>
                    <div className="perk-details">
                      <strong>JUSPAY Gateway Verified</strong>
                      <p>Authoritative order-linked Card, UPI & Net Banking.</p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
