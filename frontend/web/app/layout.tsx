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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Bodoni+Moda:ital,opsz,wght@0,6..96,500..700;1,6..96,500..700&family=Pixelify+Sans:wght@400..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
