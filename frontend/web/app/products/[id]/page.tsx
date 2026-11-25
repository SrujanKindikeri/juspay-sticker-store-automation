'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { StoreNavbar } from '../../../components/store/StoreNavbar';
import { ProductCard } from '../../../components/store/ProductCard';
import { StoreFooter } from '../../../components/store/StoreFooter';
import { StickerProduct, useCart } from '../../../context/CartContext';

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params?.id as string;
  const { addItem } = useCart();

  const [product, setProduct] = useState<StickerProduct | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<StickerProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [quantity, setQuantity] = useState<number>(1);
  const [added, setAdded] = useState<boolean>(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  useEffect(() => {
    if (!productId) return;

    const fetchProduct = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/store/products/${productId}`);
        if (res.ok) {
          const data: StickerProduct = await res.json();
          setProduct(data);

          // Fetch related in same category
          const relRes = await fetch(`${apiUrl}/api/v1/store/products?category=${data.category}&limit=4`);
          if (relRes.ok) {
            const relData = await relRes.json();
            const filtered = (relData.items || []).filter((p: StickerProduct) => p.id !== data.id);
            setRelatedProducts(filtered.slice(0, 3));
          }
        } else {
          setProduct(null);
        }
      } catch (err) {
        console.error('Failed to load product details', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId, apiUrl]);

  const handleAddToCart = () => {
    if (!product) return;
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  if (loading) {
    return (
      <div>
        <StoreNavbar />
        <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
          Loading sticker details...
        </div>
        <StoreFooter />
      </div>
    );
  }

  if (!product) {
    return (
      <div>
        <StoreNavbar />
        <div className="store-section" style={{ minHeight: '50vh', textAlign: 'center', paddingTop: '4rem' }}>
          <h2>Sticker Product Not Found</h2>
          <p style={{ color: '#64748b', margin: '1rem 0 2rem' }}>The sticker you are looking for does not exist or has been removed.</p>
          <Link href="/products" className="hero-btn-primary">
            ← Browse All Stickers
          </Link>
        </div>
        <StoreFooter />
      </div>
    );
  }

  return (
    <div className="store-page-root" data-testid="product-detail-page">
      <StoreNavbar />

      <main className="product-detail-page">
        <Link href="/products" className="back-link" data-testid="back-to-products-link">
          ← Back to All Stickers
        </Link>

        <div className="product-detail-grid">
          {/* Gallery */}
          <div className="detail-gallery">
            <div className="gallery-main" data-testid="gallery-main-image">
              <img src={product.image_url} alt={product.name} />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <div style={{ width: '60px', height: '60px', border: '2px solid #2563eb', borderRadius: '8px', padding: '4px', background: '#f8fafc' }}>
                <img src={product.image_url} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="detail-info">
            <div className="detail-category">{product.category.toUpperCase()}</div>
            <h1 className="detail-title" data-testid="product-detail-title">{product.name}</h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ color: '#f59e0b', fontSize: '1.1rem' }}>★★★★★</span>
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{product.rating.toFixed(1)}</span>
              <span style={{ color: '#94a3b8', fontSize: '0.88rem' }}>({product.review_count} verified reviews)</span>
            </div>

            <div className="detail-price" data-testid="product-detail-price">
              ₹{product.price.toFixed(2)}
            </div>

            <p className="detail-desc" data-testid="product-detail-description">
              {product.description}
            </p>

            <div className="detail-specs-list">
              <div className="spec-item">
                <span>Product ID:</span>
                <code data-testid="product-detail-id">{product.id}</code>
              </div>
              <div className="spec-item">
                <span>Dimensions:</span>
                <strong>{product.size}</strong>
              </div>
              <div className="spec-item">
                <span>Material &amp; Finish:</span>
                <strong>{product.material}</strong>
              </div>
              <div className="spec-item">
                <span>Availability:</span>
                <strong data-testid="product-detail-stock" style={{ color: product.stock_quantity > 0 ? '#15803d' : '#b91c1c' }}>
                  {product.stock_quantity > 0 ? `In Stock (${product.stock_quantity} available)` : 'Out of Stock'}
                </strong>
              </div>
            </div>

            <div className="detail-actions">
              <div className="quantity-stepper" data-testid="quantity-stepper">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  data-testid="decrease-qty-btn"
                >
                  -
                </button>
                <span data-testid="qty-display">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(product.stock_quantity, q + 1))}
                  data-testid="increase-qty-btn"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className="detail-add-btn"
                onClick={handleAddToCart}
                disabled={product.stock_quantity <= 0}
                data-testid="detail-add-to-cart-btn"
              >
                {added ? '✓ Added to Cart!' : 'Add to Cart 🛒'}
              </button>
            </div>
          </div>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <section className="store-section" style={{ marginTop: '3.5rem', padding: 0 }}>
            <h3 className="section-title" style={{ fontSize: '1.35rem', marginBottom: '1.25rem' }}>
              Similar Stickers You Might Like
            </h3>
            <div className="products-grid">
              {relatedProducts.map((rel) => (
                <ProductCard key={rel.id} product={rel} />
              ))}
            </div>
          </section>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
