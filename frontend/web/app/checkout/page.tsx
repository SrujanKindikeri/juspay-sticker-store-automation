'use client';

import React, { useState, useRef, useEffect } from 'react';
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

  // Customer Contact Verification Channel ('email' | 'whatsapp') & OTP States
  const [contactChannel, setContactChannel] = useState<'email' | 'whatsapp'>('email');
  const [waAvailability, setWaAvailability] = useState<{
    enabled: boolean;
    experimental: boolean;
    available: boolean;
    message: string;
  }>({
    enabled: true,
    experimental: true,
    available: false,
    message: 'Checking WhatsApp availability...',
  });

  // Customer Email OTP Verification States (independent from Payment OTP)
  const [emailVerified, setEmailVerified] = useState<boolean>(false);
  const [verifiedEmailAddress, setVerifiedEmailAddress] = useState<string>('');
  const [verificationSessionId, setVerificationSessionId] = useState<string>('');
  const [verificationToken, setVerificationToken] = useState<string>('');
  const [emailOtpSent, setEmailOtpSent] = useState<boolean>(false);
  const [emailOtpInput, setEmailOtpInput] = useState<string>('');
  const [emailOtpDevCode, setEmailOtpDevCode] = useState<string>('');
  const [sendingEmailOtp, setSendingEmailOtp] = useState<boolean>(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState<boolean>(false);
  const [emailOtpError, setEmailOtpError] = useState<string>('');
  const [emailOtpInfo, setEmailOtpInfo] = useState<string>('');
  const [emailResendCooldown, setEmailResendCooldown] = useState<number>(0);

  // Customer WhatsApp OTP Verification States (independent from Payment OTP)
  const [whatsappVerified, setWhatsappVerified] = useState<boolean>(false);
  const [verifiedWhatsappPhone, setVerifiedWhatsappPhone] = useState<string>('');
  const [waSessionId, setWaSessionId] = useState<string>('');
  const [waVerificationToken, setWaVerificationToken] = useState<string>('');
  const [waOtpSent, setWaOtpSent] = useState<boolean>(false);
  const [waOtpInput, setWaOtpInput] = useState<string>('');
  const [sendingWaOtp, setSendingWaOtp] = useState<boolean>(false);
  const [verifyingWaOtp, setVerifyingWaOtp] = useState<boolean>(false);
  const [waOtpError, setWaOtpError] = useState<string>('');
  const [waOtpInfo, setWaOtpInfo] = useState<string>('');
  const [waResendCooldown, setWaResendCooldown] = useState<number>(0);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/v1/verification/whatsapp/availability`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setWaAvailability({
            enabled: Boolean(data.enabled),
            experimental: Boolean(data.experimental),
            available: Boolean(data.available),
            message: data.message || '',
          });
        }
      })
      .catch(() => {
        if (active) {
          setWaAvailability((prev) => ({
            ...prev,
            available: false,
            message: 'WhatsApp verification is currently unavailable. Please verify via Email OTP.',
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [apiUrl]);

  useEffect(() => {
    if (emailResendCooldown <= 0) return;
    const timer = setTimeout(() => setEmailResendCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [emailResendCooldown]);

  useEffect(() => {
    if (waResendCooldown <= 0) return;
    const timer = setTimeout(() => setWaResendCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [waResendCooldown]);

  const normalizeWhatsAppPhoneToE164 = (
    rawPhone: string
  ): { e164: string; valid: boolean; error?: string } => {
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      return {
        e164: '',
        valid: false,
        error: 'Enter your 10-digit Indian mobile number (e.g. 9640404455) before requesting WhatsApp OTP.',
      };
    }

    const withPlus = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
    const stripped = withPlus.replace(/[\s\-().]/g, '');
    const hasPlus = stripped.startsWith('+');
    const digits = stripped.replace(/\D/g, '');

    if (!hasPlus && digits.length === 10) {
      if (!/^[6-9]\d{9}$/.test(digits)) {
        return {
          e164: '',
          valid: false,
          error: 'Enter a valid 10-digit Indian mobile number starting with 6–9 (e.g. 9640404455).',
        };
      }
      return { e164: `+91${digits}`, valid: true };
    }

    if (!hasPlus && digits.length === 11 && digits.startsWith('0') && /^0[6-9]\d{9}$/.test(digits)) {
      return { e164: `+91${digits.slice(1)}`, valid: true };
    }

    if (digits.startsWith('91') && digits.length === 12) {
      if (!/^91[6-9]\d{9}$/.test(digits)) {
        return {
          e164: '',
          valid: false,
          error: 'Enter a valid Indian WhatsApp number (+91 followed by 10 digits starting with 6–9).',
        };
      }
      return { e164: `+${digits}`, valid: true };
    }

    if (hasPlus && digits.length >= 10 && digits.length <= 15 && /^[1-9]\d{9,14}$/.test(digits)) {
      return { e164: `+${digits}`, valid: true };
    }

    return {
      e164: '',
      valid: false,
      error: 'Enter a valid mobile number in 10-digit Indian or +91 E.164 format (e.g. +919640404455).',
    };
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === 'email') {
      const normalized = value.trim().toLowerCase();
      if (emailVerified && normalized !== verifiedEmailAddress) {
        setEmailVerified(false);
        setVerifiedEmailAddress('');
        setVerificationSessionId('');
        setVerificationToken('');
      }
      if (normalized !== verifiedEmailAddress) {
        setEmailOtpSent(false);
        setEmailOtpInput('');
        setEmailOtpDevCode('');
        setEmailOtpError('');
        setEmailOtpInfo('');
      }
    }

    if (name === 'phone') {
      const normalizedPhone = normalizeWhatsAppPhoneToE164(value);
      const comparablePhone = normalizedPhone.valid ? normalizedPhone.e164 : value.replace(/[\s\-()]/g, '');
      if (whatsappVerified && comparablePhone !== verifiedWhatsappPhone) {
        setWhatsappVerified(false);
        setVerifiedWhatsappPhone('');
        setWaSessionId('');
        setWaVerificationToken('');
      }
      if (comparablePhone !== verifiedWhatsappPhone) {
        setWaOtpSent(false);
        setWaOtpInput('');
        setWaOtpError('');
        setWaOtpInfo('');
      }
    }

    if (fieldErrors[name as keyof DeliveryFormData]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const handleSendEmailOtp = async (isResend: boolean = false) => {
    const cleanEmail = formData.email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(cleanEmail)) {
      setFieldErrors((prev) => ({ ...prev, email: 'Please enter a valid email address before verifying.' }));
      return;
    }

    setSendingEmailOtp(true);
    setEmailOtpError('');
    setEmailOtpInfo('');

    try {
      const bodyPayload: Record<string, string> = { email: cleanEmail };
      if (isResend && verificationSessionId) {
        bodyPayload.session_id = verificationSessionId;
      }

      const res = await fetch(`${apiUrl}/api/v1/email-verification/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(data, res.status));
      }

      setVerificationSessionId(data.session_id);
      setEmailOtpSent(true);
      setEmailOtpInput('');
      setEmailOtpDevCode(data.simulated_otp || '');
      setEmailResendCooldown(data.cooldown_seconds || 30);
      setEmailOtpInfo(
        isResend
          ? `A fresh 6-digit OTP was sent to ${cleanEmail}.`
          : `Verification OTP sent to ${cleanEmail}. Valid for 5 minutes.`
      );
    } catch (err: any) {
      setEmailOtpError(err?.message || 'Unable to send email verification OTP.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    const cleanEmail = formData.email.trim().toLowerCase();
    const cleanOtp = emailOtpInput.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      setEmailOtpError('Please enter a valid 6-digit numeric email OTP.');
      return;
    }

    setVerifyingEmailOtp(true);
    setEmailOtpError('');

    try {
      const res = await fetch(`${apiUrl}/api/v1/email-verification/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: verificationSessionId,
          email: cleanEmail,
          otp: cleanOtp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(data, res.status));
      }

      setEmailVerified(true);
      setVerifiedEmailAddress(cleanEmail);
      setVerificationToken(data.verification_token);
      setEmailOtpSent(false);
      setEmailOtpDevCode('');
      setEmailOtpInfo('');
      setFieldErrors((prev) => ({ ...prev, email: '' }));
    } catch (err: any) {
      setEmailOtpError(err?.message || 'Email OTP verification failed.');
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  const handleSendWhatsAppOtp = async (isResend: boolean = false) => {
    const normalized = normalizeWhatsAppPhoneToE164(formData.phone);
    if (!normalized.valid) {
      const msg = normalized.error || 'Enter a valid mobile number before requesting WhatsApp OTP.';
      setFieldErrors((prev) => ({ ...prev, phone: msg }));
      setWaOtpError(msg);
      setWaOtpInfo('');
      return;
    }

    // Display normalized E.164 number (+91...) consistently across form and OTP confirmation
    if (formData.phone.trim() !== normalized.e164) {
      setFormData((prev) => ({ ...prev, phone: normalized.e164 }));
    }

    setSendingWaOtp(true);
    setWaOtpError('');
    setWaOtpInfo('');
    setFieldErrors((prev) => ({ ...prev, phone: '' }));

    try {
      const bodyPayload: Record<string, string> = { phone: normalized.e164 };
      if (isResend && waSessionId) {
        bodyPayload.session_id = waSessionId;
      }

      const res = await fetch(`${apiUrl}/api/v1/verification/whatsapp/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 503) {
          setWaAvailability((prev) => ({
            ...prev,
            available: false,
            message: typeof data?.detail === 'string' ? data.detail : prev.message,
          }));
        }
        throw new Error(extractApiErrorMessage(data, res.status));
      }

      if (!data?.session_id) {
        throw new Error('WhatsApp verification response was incomplete. Please try again.');
      }

      setWaAvailability((prev) => ({
        ...prev,
        available: true,
        message: 'Experimental WhatsApp OTP verification is online.',
      }));
      setWaSessionId(data.session_id);
      setWaOtpSent(true);
      setWaOtpInput('');
      setWaResendCooldown(data.cooldown_seconds || 30);
      setWaOtpInfo(
        `${data.message || `Verification OTP submitted to ${normalized.e164} via WhatsApp.`} (Target: ${normalized.e164})`
      );
    } catch (err: any) {
      if (!isResend) {
        setWaOtpSent(false);
      }
      if (err?.name === 'TypeError' || (typeof err?.message === 'string' && err.message.includes('Failed to fetch'))) {
        setWaOtpError(
          'Network error: unable to reach the WhatsApp verification service. Verify backend & sidecar are running or switch to Email OTP.'
        );
      } else {
        setWaOtpError(
          err?.message || 'Unable to send WhatsApp OTP. You can switch to Email OTP verification.'
        );
      }
    } finally {
      setSendingWaOtp(false);
    }
  };

  const handleVerifyWhatsAppOtp = async () => {
    const normalized = normalizeWhatsAppPhoneToE164(formData.phone);
    if (!normalized.valid) {
      setWaOtpError(normalized.error || 'Invalid mobile number.');
      return;
    }
    if (!waSessionId) {
      setWaOtpError('Request a WhatsApp OTP first before verifying.');
      return;
    }

    const cleanOtp = waOtpInput.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      setWaOtpError('Please enter a valid 6-digit numeric WhatsApp OTP.');
      return;
    }

    setVerifyingWaOtp(true);
    setWaOtpError('');

    try {
      const res = await fetch(`${apiUrl}/api/v1/verification/whatsapp/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: waSessionId,
          phone: normalized.e164,
          otp: cleanOtp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(data, res.status));
      }
      if (!data?.verified || !data?.verification_token) {
        throw new Error('Backend did not confirm WhatsApp verification. Please try again.');
      }

      setWhatsappVerified(true);
      setVerifiedWhatsappPhone(normalized.e164);
      setWaVerificationToken(data.verification_token);
      setWaOtpSent(false);
      setWaOtpInfo('');
      setFieldErrors((prev) => ({ ...prev, phone: '' }));
    } catch (err: any) {
      if (err?.name === 'TypeError' || (typeof err?.message === 'string' && err.message.includes('Failed to fetch'))) {
        setWaOtpError('Network error while verifying WhatsApp OTP. Please check your connection and try again.');
      } else {
        setWaOtpError(err?.message || 'WhatsApp OTP verification failed.');
      }
    } finally {
      setVerifyingWaOtp(false);
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

    if (contactChannel === 'whatsapp') {
      if (!whatsappVerified || !waSessionId || !waVerificationToken) {
        setFieldErrors((prev) => ({
          ...prev,
          phone: 'Please verify your WhatsApp mobile number with the 6-digit OTP before placing your order.',
        }));
        setGeneralError('Please verify your WhatsApp number before placing your order.');
        return;
      }
    } else if (!emailVerified || !verificationSessionId || !verificationToken) {
      setFieldErrors((prev) => ({
        ...prev,
        email: 'Please verify your email address with the 6-digit OTP before placing your order.',
      }));
      setGeneralError('Please verify your customer email address before placing your order.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const cleanPhone = formData.phone.replace(/[\s\-\+]/g, '');
      const finalPhone = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone.slice(2) : cleanPhone;
      const cleanPincode = formData.pincode.replace(/\s/g, '');

      const payload: Record<string, any> = {
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
        contact_verification_channel: contactChannel,
      };

      if (contactChannel === 'whatsapp') {
        payload.whatsapp_verification_session_id = waSessionId;
        payload.whatsapp_verification_token = waVerificationToken;
      } else {
        payload.email_verification_session_id = verificationSessionId;
        payload.email_verification_token = verificationToken;
      }

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
                    <div className="checkout-contact-group">
                      <div className="checkout-contact-group-title">
                        Recipient &amp; Contact Verification
                      </div>

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

                      <div className="contact-channel-box" data-testid="contact-verification-selector" role="group" aria-label="Contact verification method">
                        <div className="contact-channel-header">
                          <span className="input-label" style={{ marginBottom: 0 }}>
                            Contact Verification Method <span className="req">*</span>
                          </span>
                          <span className="contact-channel-sub">Verify email or WhatsApp before placing your order</span>
                        </div>
                        <div className="contact-channel-pills">
                          <button
                            type="button"
                            className={`channel-pill ${contactChannel === 'email' ? 'active' : ''}`}
                            aria-pressed={contactChannel === 'email'}
                            onClick={() => setContactChannel('email')}
                            data-testid="select-channel-email"
                          >
                            ✉️ Verify via Email OTP
                          </button>
                          {waAvailability.enabled && (
                            <button
                              type="button"
                              className={`channel-pill ${contactChannel === 'whatsapp' ? 'active' : ''}`}
                              aria-pressed={contactChannel === 'whatsapp'}
                              onClick={() => setContactChannel('whatsapp')}
                              data-testid="select-channel-whatsapp"
                            >
                              💬 Verify via WhatsApp OTP (Experimental)
                            </button>
                          )}
                        </div>
                        {contactChannel === 'whatsapp' && (
                          <p className="whatsapp-experimental-note" data-testid="whatsapp-availability-note">
                            Experimental WhatsApp Web OTP channel{waAvailability.available ? ' — online' : ` — ${waAvailability.message}`}
                          </p>
                        )}
                      </div>

                      <div className="form-grid-2">
                        <div className="form-group">
                          <label htmlFor="phone" className="input-label">
                            Mobile Number <span className="req">*</span>
                          </label>
                          <div className={contactChannel === 'whatsapp' ? 'email-verify-row' : ''}>
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
                            {contactChannel === 'whatsapp' && (
                              !whatsappVerified ? (
                                <button
                                  type="button"
                                  className="btn-verify-whatsapp"
                                  onClick={() => handleSendWhatsAppOtp(false)}
                                  disabled={sendingWaOtp}
                                  aria-busy={sendingWaOtp}
                                  data-testid="verify-whatsapp-button"
                                >
                                  {sendingWaOtp ? 'Sending...' : waOtpSent ? 'Sent' : 'Verify WhatsApp'}
                                </button>
                              ) : (
                                <span className="whatsapp-verified-badge" role="status" data-testid="whatsapp-verified-badge">
                                  ✓ WhatsApp Verified
                                </span>
                              )
                            )}
                          </div>
                          {fieldErrors.phone && (
                            <span className="error-text">{fieldErrors.phone}</span>
                          )}
                        </div>

                        <div className="form-group">
                          <label htmlFor="email" className="input-label">
                            Email Address <span className="req">*</span>
                          </label>
                          <div className={contactChannel === 'email' ? 'email-verify-row' : ''}>
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
                            {contactChannel === 'email' && (
                              !emailVerified ? (
                                <button
                                  type="button"
                                  className="btn-verify-email"
                                  onClick={() => handleSendEmailOtp(false)}
                                  disabled={sendingEmailOtp}
                                  data-testid="verify-email-button"
                                >
                                  {sendingEmailOtp ? 'Sending...' : emailOtpSent ? 'Sent' : 'Verify Email'}
                                </button>
                              ) : (
                                <span className="email-verified-badge" role="status" data-testid="email-verified-badge">
                                  ✓ Email Verified
                                </span>
                              )
                            )}
                          </div>
                          {fieldErrors.email && (
                            <span className="error-text">{fieldErrors.email}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Email OTP Verification Box */}
                    {contactChannel === 'email' && emailOtpSent && !emailVerified && (
                      <div className="email-otp-card" data-testid="email-otp-box">
                        <div className="email-otp-header">
                          <strong>Verify Your Email</strong>
                          <span>Enter the 6-digit OTP sent to {formData.email.trim().toLowerCase()}</span>
                        </div>

                        {emailOtpDevCode && (
                          <div className="email-otp-dev-pill" data-testid="email-otp-dev-box">
                            <span>
                              🧪 Sandbox Email OTP: <strong data-testid="email-otp-dev-code">{emailOtpDevCode}</strong>
                            </span>
                            <button
                              type="button"
                              className="autofill-otp-btn"
                              onClick={() => setEmailOtpInput(emailOtpDevCode)}
                              data-testid="email-otp-autofill-btn"
                            >
                              Autofill
                            </button>
                          </div>
                        )}

                        <div className="email-otp-input-row">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            aria-label="Email verification 6-digit OTP"
                            className="input-field email-otp-field"
                            placeholder="Enter 6-digit OTP"
                            value={emailOtpInput}
                            onChange={(e) => {
                              setEmailOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                              if (emailOtpError) setEmailOtpError('');
                            }}
                            data-testid="email-otp-input"
                          />
                          <button
                            type="button"
                            className="btn-confirm-email-otp"
                            onClick={handleVerifyEmailOtp}
                            disabled={verifyingEmailOtp}
                            data-testid="confirm-email-otp-button"
                          >
                            {verifyingEmailOtp ? 'Verifying...' : 'Confirm OTP'}
                          </button>
                          <button
                            type="button"
                            className="btn-resend-email-otp"
                            onClick={() => handleSendEmailOtp(true)}
                            disabled={sendingEmailOtp || emailResendCooldown > 0}
                            data-testid="resend-email-otp-button"
                          >
                            {emailResendCooldown > 0 ? `Resend (${emailResendCooldown}s)` : 'Resend OTP'}
                          </button>
                        </div>

                        {emailOtpInfo && !emailOtpError && (
                          <p className="email-otp-info" data-testid="email-otp-info">{emailOtpInfo}</p>
                        )}
                        {emailOtpError && (
                          <p className="error-text" data-testid="email-otp-error">{emailOtpError}</p>
                        )}
                      </div>
                    )}

                    {/* WhatsApp OTP Verification Box */}
                    {contactChannel === 'whatsapp' && (waOtpSent || waOtpError) && !whatsappVerified && (
                      <div className="email-otp-card" data-testid="whatsapp-otp-box">
                        <div className="email-otp-header">
                          <strong>
                            {waOtpSent
                              ? 'Verify Your WhatsApp Number (Experimental)'
                              : 'WhatsApp Verification Unavailable'}
                          </strong>
                          <span>
                            {waOtpSent
                              ? `Enter the 6-digit code sent via WhatsApp to ${formData.phone.trim()}`
                              : `Unable to send WhatsApp OTP to ${formData.phone.trim() || 'this number'}.`}
                          </span>
                        </div>

                        {waOtpSent && (
                          <div className="email-otp-input-row">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              aria-label="WhatsApp verification 6-digit OTP"
                              className="input-field email-otp-field"
                              placeholder="Enter 6-digit OTP"
                              value={waOtpInput}
                              onChange={(e) => {
                                setWaOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                                if (waOtpError) setWaOtpError('');
                              }}
                              data-testid="whatsapp-otp-input"
                            />
                            <button
                              type="button"
                              className="btn-confirm-email-otp"
                              onClick={handleVerifyWhatsAppOtp}
                              disabled={verifyingWaOtp}
                              data-testid="confirm-whatsapp-otp-button"
                            >
                              {verifyingWaOtp ? 'Verifying...' : 'Confirm OTP'}
                            </button>
                            <button
                              type="button"
                              className="btn-resend-email-otp"
                              onClick={() => handleSendWhatsAppOtp(true)}
                              disabled={sendingWaOtp || waResendCooldown > 0}
                              data-testid="resend-whatsapp-otp-button"
                            >
                              {waResendCooldown > 0 ? `Resend (${waResendCooldown}s)` : 'Resend OTP'}
                            </button>
                          </div>
                        )}

                        {waOtpInfo && !waOtpError && (
                          <p className="email-otp-info" data-testid="whatsapp-otp-info">{waOtpInfo}</p>
                        )}
                        {waOtpError && (
                          <p className="error-text" data-testid="whatsapp-otp-error">{waOtpError}</p>
                        )}
                      </div>
                    )}

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

                  {contactChannel === 'whatsapp' && !whatsappVerified && (
                    <p className="whatsapp-lock-note" data-testid="place-order-lock-note">
                      Verify your WhatsApp mobile number with the 6-digit OTP above to enable Place Order.
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn-place-order"
                    disabled={
                      submitting ||
                      Boolean(confirmedOrder) ||
                      (contactChannel === 'whatsapp' && !whatsappVerified)
                    }
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
