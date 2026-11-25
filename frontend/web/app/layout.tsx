import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '../context/CartContext';

export const metadata: Metadata = {
  title: 'Stickora — Premium Vinyl Stickers',
  description: 'Stickora storefront for premium waterproof die-cut vinyl stickers. Secured by JUSPAY Payment Gateway.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
