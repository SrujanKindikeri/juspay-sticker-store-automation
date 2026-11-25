'use client';

import React from 'react';
import { OrderDetails } from '../types/checkout';

interface OrderSummaryItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface OrderSummaryProps {
  order: OrderDetails;
  storeItems?: OrderSummaryItem[];
}

export const OrderSummary: React.FC<OrderSummaryProps> = ({ order, storeItems }) => {
  const isStoreOrder = order.orderId.startsWith('STK-ORD-');
  const isStoreLoading = isStoreOrder && order.merchantName === 'Demo Store';

  return (
    <section className="order-summary-card" data-testid="order-summary">
      <div className="order-header">
        <div>
          <span className="merchant-label">Merchant</span>
          <h2 className="merchant-name">
            {isStoreLoading ? 'Stickora' : order.merchantName}
          </h2>
          {isStoreOrder && (
            <span className="merchant-tagline">Premium Vinyl Stickers</span>
          )}
        </div>
        <div className="simulated-badge" data-testid="simulated-order-badge">
          <span>● {isStoreOrder ? 'Sandbox Order' : 'Simulated Order'}</span>
        </div>
      </div>

      <div className="order-details-body">
        <div className="product-row">
          <div className="product-icon-wrap">
            {isStoreOrder ? (
              <span style={{ fontSize: '1.15rem' }}>✦</span>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
          </div>
          <div className="product-info">
            <h3 className="product-name">
              {isStoreLoading ? 'Loading Stickora order...' : order.productName}
            </h3>
            <p className="order-id">
              Order ID: <code data-testid="order-id-value">{order.orderId}</code>
            </p>
          </div>
          {!isStoreLoading ? (
            <div className="product-price" data-testid="order-amount">
              ₹{order.amount.toFixed(2)}
            </div>
          ) : (
            <div className="product-price">Loading...</div>
          )}
        </div>

        {storeItems && storeItems.length > 0 && !isStoreLoading && (
          <div className="gateway-items-mini-list" data-testid="gateway-order-items">
            {storeItems.map((it) => (
              <div key={it.product_id} className="gateway-mini-item">
                <span className="mini-item-name">
                  {it.product_name} <span className="mini-item-qty">× {it.quantity}</span>
                </span>
                <span className="mini-item-price">₹{Number(it.total_price).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pricing-breakdown">
          <div className="price-row">
            <span>{isStoreOrder ? 'Items Subtotal' : 'Base Subscription'}</span>
            <span>{isStoreLoading ? '...' : `₹${order.baseAmount.toFixed(2)}`}</span>
          </div>
          <div className="price-row">
            <span>{isStoreOrder ? 'Delivery Charge' : 'GST (18% Simulated)'}</span>
            <span>
              {isStoreLoading
                ? '...'
                : isStoreOrder && order.tax === 0
                ? 'FREE'
                : `₹${order.tax.toFixed(2)}`}
            </span>
          </div>
          <div className="price-row total-row">
            <span>Total Payable ({order.currency})</span>
            {!isStoreLoading ? (
              <span className="total-amount" data-testid="total-amount">
                ₹{order.amount.toFixed(2)}
              </span>
            ) : (
              <span className="total-amount">Loading...</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
