'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface StickerProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  stock_quantity: number;
  size: string;
  material: string;
  image_url: string;
  gallery_images?: string;
  rating: number;
  review_count: number;
  is_featured: boolean;
  is_best_seller: boolean;
  is_new_arrival: boolean;
  is_in_stock: boolean;
}

export interface CartItem {
  product: StickerProduct;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  isCartLoaded: boolean;
  addItem: (product: StickerProduct, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalCount: number;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  freeShippingThreshold: number;
  freeShippingRemaining: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'juspay_sticker_cart_v1';
const FREE_SHIPPING_THRESHOLD = 499.0;
const STANDARD_DELIVERY_FEE = 50.0;

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }
    } catch {
      // ignore parsing errors
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore storage errors
    }
  }, [items, isLoaded]);

  const addItem = (product: StickerProduct, quantity: number = 1) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      const currentQty = existing ? existing.quantity : 0;
      const targetQty = currentQty + quantity;
      const finalQty = Math.min(targetQty, product.stock_quantity);

      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: finalQty } : item
        );
      } else {
        return [...prev, { product, quantity: finalQty }];
      }
    });
  };

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) {
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          const maxStock = item.product.stock_quantity;
          return { ...item, quantity: Math.min(Math.max(1, quantity), maxStock) };
        }
        return item;
      })
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = Math.round(
    items.reduce((sum, item) => sum + item.product.price * item.quantity, 0) * 100
  ) / 100;

  const deliveryFee = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0.0 : STANDARD_DELIVERY_FEE;
  const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;
  const freeShippingRemaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);

  return (
    <CartContext.Provider
      value={{
        items,
        isCartLoaded: isLoaded,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalCount,
        subtotal,
        deliveryFee,
        totalAmount,
        freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
        freeShippingRemaining,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = (): CartContextType => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
