'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { StoreNavbar } from '@/components/store/StoreNavbar';
import { StoreFooter } from '@/components/store/StoreFooter';
import { useCart } from '@/context/CartContext';

interface DeliveryFormData {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

interface ConfirmedOrder {
  order_id: string;
  status: string;
  subtotal: number;
  delivery_fee: number;
  total_amount: number;
  currency: string;
  order_token?: string;
  items: Array<{
    product_id: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    total_price: number;
  }>;
  delivery: {
    full_name: string;
    mobile_number: string;
    email: string;
    address_line: string;
    city: string;
    state: string;
    pincode: string;
  };
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, isCartLoaded, subtotal, deliveryFee, totalAmount, clearCart } = useCart();

  const [formData, setFormData] = useState<DeliveryFormData>({
    fullName: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof DeliveryFormData, string>>>({});
  const [generalError, setGeneralError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null);
  const submitLockRef = useRef<boolean>(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name as keyof DeliveryFormData]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof DeliveryFormData, string>> = {};

    if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
      errors.fullName = 'Full name must be at least 2 characters.';
    }

    const cleanPhone = formData.phone.replace(/[\s\-\+]/g, '');
    const finalPhone = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone.slice(2) : cleanPhone;
    if (!/^[6-9]\d{9}$/.test(finalPhone)) {
      errors.phone = 'Please enter a valid 10-digit Indian mobile number.';
    }

    if (!/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!formData.address.trim() || formData.address.trim().length < 5) {
      errors.address = 'Street address must be at least 5 characters.';
    }

    if (!formData.city.trim() || formData.city.trim().length < 2) {
      errors.city = 'Please enter your city.';
    }

    if (!formData.state.trim() || formData.state.trim().length < 2) {
      errors.state = 'Please enter or select your state.';
    }

    const cleanPincode = formData.pincode.replace(/\s/g, '');
    if (!/^[1-9]\d{5}$/.test(cleanPincode)) {
      errors.pincode = 'PIN code must be a valid 6-digit Indian postal code.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const extractApiErrorMessage = (data: any, statusCode: number): string => {
    if (data && Array.isArray(data.detail)) {
      const msgs = data.detail
        .map((err: any) => {
          const field = Array.isArray(err?.loc) ? err.loc[err.loc.length - 1] : '';
          const msg = err?.msg || 'Invalid value';
          return field ? `${field}: ${msg}` : msg;
        })
        .filter(Boolean);
      if (msgs.length > 0) {
        return msgs.join(' | ');
      }
    }
    if (typeof data?.detail === 'string' && data.detail.trim()) {
      return data.detail;
    }
    return `Failed to create order (HTTP ${statusCode}). Please verify your details and stock availability.`;
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent accidental duplicate submissions (e.g. rapid double-click)
    if (submitLockRef.current || submitting || confirmedOrder) {
      return;
    }

    setGeneralError('');

    if (items.length === 0 || items.some((item) => !item.product?.id || item.quantity < 1)) {
      setGeneralError('Your cart is empty or contains invalid items. Please add items before checking out.');
      return;
    }

    if (!validate()) {
      setGeneralError('Please correct the errors in the delivery form.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const cleanPhone = formData.phone.replace(/[\s\-\+]/g, '');
      const finalPhone = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone.slice(2) : cleanPhone;
      const cleanPincode = formData.pincode.replace(/\s/g, '');

      const payload = {
        items: items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
        delivery: {
          full_name: formData.fullName.trim(),
          mobile_number: finalPhone,
          email: formData.email.trim().toLowerCase(),
          address_line: formData.address.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          pincode: cleanPincode,
        },
      };

      const res = await fetch(`${apiUrl}/api/v1/store/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data: any = null;
      try {
        const rawText = await res.text();
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(extractApiErrorMessage(data, res.status));
      }

      if (!data?.order_id) {
        throw new Error('Order response was incomplete. Please try again.');
      }

      // Preserve order state during navigation so cart clearing does not flash empty-cart view
      setConfirmedOrder(data);
      clearCart();

      const paymentUrl = `/payment?order_id=${encodeURIComponent(data.order_id)}${
        data.order_token ? `&token=${encodeURIComponent(data.order_token)}` : ''
      }`;
      router.push(paymentUrl);
    } catch (err: any) {
      submitLockRef.current = false;
      setSubmitting(false);
      if (err?.name === 'TypeError' || (typeof err?.message === 'string' && err.message.includes('Failed to fetch'))) {
        setGeneralError('Unable to reach the order service. Please verify the backend is running and try again.');
      } else {
        setGeneralError(err?.message || 'An error occurred while creating your order.');
      }
    }
  };

  return (
    <div className="store-page">
      <StoreNavbar />

      <main className="cart-container">
        <div className="catalog-breadcrumb">
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href="/cart">Cart</Link>
          <span>/</span>
          <span className="current">Checkout</span>
        </div>

        {confirmedOrder ? (
          /* Order Created -> Redirecting to JUSPAY Payment Gateway */
          <div className="order-confirmation-container" data-testid="order-confirmation-screen">
            <div className="order-icon-badge">✓</div>
            <h1 className="confirmation-title">Order Created! Redirecting to JUSPAY Payment...</h1>
            <p className="confirmation-lead">
              Your physical sticker order <strong data-testid="order-id-confirmation">{confirmedOrder.order_id}</strong> has been created with status{' '}
              <span className="order-status-pill" data-testid="order-status-badge">{confirmedOrder.status}</span>.
            </p>
            <p className="confirmation-lead">
              Authoritative Total: <strong data-testid="order-total-amount">₹{confirmedOrder.total_amount.toFixed(2)}</strong>
            </p>

            <div className="confirmation-actions" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem', flexWrap: 'wrap' }}>
              <Link
                href={`/payment?order_id=${encodeURIComponent(confirmedOrder.order_id)}${confirmedOrder.order_token ? `&token=${encodeURIComponent(confirmedOrder.order_token)}` : ''}`}
                className="btn-pay-now"
                data-testid="proceed-to-payment-gateway-btn"
              >
                Continue to JUSPAY Payment (₹{confirmedOrder.total_amount.toFixed(2)}) →
              </Link>
            </div>
          </div>
        ) : !isCartLoaded ? (
          <div className="empty-cart-view" data-testid="checkout-loading">
            <div className="empty-cart-icon">⏳</div>
            <h2 className="empty-cart-title">Loading Checkout...</h2>
          </div>
        ) : items.length === 0 ? (
          /* Empty Cart View */
          <div className="empty-cart-view" data-testid="empty-cart-container">
            <div className="empty-cart-icon">🛍️</div>
            <h2 className="empty-cart-title" data-testid="empty-cart-message">Your cart is empty</h2>
            <p className="empty-cart-subtitle">
              You must add stickers to your shopping cart before you can proceed to delivery checkout.
            </p>
            <Link
              href="/products"
              className="btn-continue-shopping"
              data-testid="continue-shopping-btn"
            >
              Browse Stickers Catalogue
            </Link>
          </div>
        ) : (
          /* Checkout Form & Review */
          <div className="checkout-page-shell" data-testid="stickora-checkout-shell">
            <div className="checkout-page-hero">
              <div>
                <span className="checkout-eyebrow">Stickora · Premium Vinyl Stickers</span>
                <h1 className="checkout-main-title">Checkout</h1>
              </div>
              <div className="checkout-step-pills" aria-label="Checkout Steps">
                <span className="step-pill active">1. Delivery</span>
                <span className="step-arrow">→</span>
                <span className="step-pill">2. JUSPAY Payment</span>
                <span className="step-arrow">→</span>
                <span className="step-pill">3. Receipt</span>
              </div>
            </div>

            <div className="checkout-store-grid">
              {/* Delivery Form */}
              <div className="checkout-form-panel">
                <div className="form-header">
                  <h2>1. Delivery Address &amp; Contact Details</h2>
                  <p className="form-subtext">
                    Stickora vinyl stickers ship nationwide in rigid protective mailers within 24 hours.
                  </p>
                </div>

                {generalError && (
                  <div className="alert-error" role="alert" data-testid="checkout-error">
                    <span className="alert-icon">⚠️</span>
                    <span>{generalError}</span>
                  </div>
                )}

                <form onSubmit={handlePlaceOrder} noValidate>
                  <div className="form-section">
                    <div className="form-group">
                      <label htmlFor="fullName" className="input-label">
                        Full Name <span className="req">*</span>
                      </label>
                      <input
                        type="text"
                        id="fullName"
                        name="fullName"
                        className={`input-field ${fieldErrors.fullName ? 'has-error' : ''}`}
                        placeholder="e.g. Rahul Sharma"
                        value={formData.fullName}
                        onChange={handleChange}
                        data-testid="checkout-name-input"
                      />
                      {fieldErrors.fullName && (
                        <span className="error-text">{fieldErrors.fullName}</span>
                      )}
                    </div>

                    <div className="form-grid-2">
                      <div className="form-group">
                        <label htmlFor="phone" className="input-label">
                          Mobile Number <span className="req">*</span>
                        </label>
                        <input
                          type="tel"
                          id="phone"
                          name="phone"
                          className={`input-field ${fieldErrors.phone ? 'has-error' : ''}`}
                          placeholder="10-digit mobile (e.g. 9876543210)"
                          value={formData.phone}
                          onChange={handleChange}
                          data-testid="checkout-phone-input"
                        />
                        {fieldErrors.phone && (
                          <span className="error-text">{fieldErrors.phone}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="email" className="input-label">
                          Email Address <span className="req">*</span>
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          className={`input-field ${fieldErrors.email ? 'has-error' : ''}`}
                          placeholder="rahul@example.com"
                          value={formData.email}
                          onChange={handleChange}
                          data-testid="checkout-email-input"
                        />
                        {fieldErrors.email && (
                          <span className="error-text">{fieldErrors.email}</span>
                        )}
                      </div>
                    </div>

                    <div className="form-group">
                      <label htmlFor="address" className="input-label">
                        Street Address &amp; House / Flat No. <span className="req">*</span>
                      </label>
                      <input
                        type="text"
                        id="address"
                        name="address"
                        className={`input-field ${fieldErrors.address ? 'has-error' : ''}`}
                        placeholder="e.g. Flat 402, Lotus Residency, 5th Cross"
                        value={formData.address}
                        onChange={handleChange}
                        data-testid="checkout-address-input"
                      />
                      {fieldErrors.address && (
                        <span className="error-text">{fieldErrors.address}</span>
                      )}
                    </div>

                    <div className="form-grid-3">
                      <div className="form-group">
                        <label htmlFor="city" className="input-label">
                          City <span className="req">*</span>
                        </label>
                        <input
                          type="text"
                          id="city"
                          name="city"
                          className={`input-field ${fieldErrors.city ? 'has-error' : ''}`}
                          placeholder="Bengaluru"
                          value={formData.city}
                          onChange={handleChange}
                          data-testid="checkout-city-input"
                        />
                        {fieldErrors.city && (
                          <span className="error-text">{fieldErrors.city}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="state" className="input-label">
                          State <span className="req">*</span>
                        </label>
                        <input
                          type="text"
                          id="state"
                          name="state"
                          className={`input-field ${fieldErrors.state ? 'has-error' : ''}`}
                          placeholder="Karnataka"
                          value={formData.state}
                          onChange={handleChange}
                          data-testid="checkout-state-input"
                        />
                        {fieldErrors.state && (
                          <span className="error-text">{fieldErrors.state}</span>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="pincode" className="input-label">
                          PIN Code <span className="req">*</span>
                        </label>
                        <input
                          type="text"
                          id="pincode"
                          name="pincode"
                          maxLength={6}
                          className={`input-field ${fieldErrors.pincode ? 'has-error' : ''}`}
                          placeholder="560001"
                          value={formData.pincode}
                          onChange={handleChange}
                          data-testid="checkout-pincode-input"
                        />
                        {fieldErrors.pincode && (
                          <span className="error-text">{fieldErrors.pincode}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="phase-note-card">
                    <div className="note-icon">🛡️</div>
                    <div className="note-text">
                      <strong>Educational payment simulation — no real money transferred.</strong>
                      <p>
                        Your Stickora order is registered as <code>PENDING_PAYMENT</code> with authoritative server pricing, then redirected immediately to JUSPAY Payment Gateway (Card, UPI, or Net Banking).
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn-place-order"
                    disabled={submitting || Boolean(confirmedOrder)}
                    aria-busy={submitting}
                    data-testid="place-order-button"
                  >
                    {submitting ? (
                      <span className="btn-loading-inline">
                        <span className="spinner-glyph" aria-hidden="true">⏳</span>
                        <span>Placing Order...</span>
                      </span>
                    ) : (
                      <span>Place Order (Pending Payment) · ₹{totalAmount.toFixed(2)} →</span>
                    )}
                  </button>
                </form>
              </div>

              {/* Order Review Sidebar */}
              <div className="checkout-review-sidebar">
                <div className="order-review-panel">
                  <div className="review-header-row">
                    <h3 className="review-title">2. Order Summary</h3>
                    <Link href="/cart" className="review-edit-link">Edit Cart</Link>
                  </div>

                  <div className="review-items-list">
                    {items.map((item) => (
                      <div key={item.product.id} className="review-item">
                        <div className="review-item-thumb">
                          <Image
                            src={item.product.image_url}
                            alt={item.product.name}
                            width={52}
                            height={52}
                            style={{ objectFit: 'contain' }}
                          />
                        </div>
                        <div className="review-item-details">
                          <span className="review-item-name">{item.product.name}</span>
                          <span className="review-item-meta">{item.product.size} · {item.product.material}</span>
                          <span className="review-item-qty">Qty: {item.quantity} × ₹{item.product.price.toFixed(2)}</span>
                        </div>
                        <div className="review-item-total">
                          ₹{(item.product.price * item.quantity).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="summary-divider" />

                  <div className="summary-row">
                    <span className="summary-label">Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
                    <span className="summary-value" data-testid="checkout-subtotal">
                      ₹{subtotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="summary-row">
                    <span className="summary-label">Standard Shipping</span>
                    <span className={`summary-value ${deliveryFee === 0 ? 'free-text' : ''}`} data-testid="checkout-delivery-fee">
                      {deliveryFee === 0 ? 'FREE' : `₹${deliveryFee.toFixed(2)}`}
                    </span>
                  </div>

                  <div className="summary-divider" />

                  <div className="summary-row summary-total">
                    <span className="total-label">Final Payable</span>
                    <span className="total-value" data-testid="checkout-total">
                      ₹{totalAmount.toFixed(2)}
                    </span>
                  </div>

                  <div className="shipping-info-badge">
                    <span className="info-icon">🚚</span>
                    <span>Dispatched via tracked courier within 24 hours</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
