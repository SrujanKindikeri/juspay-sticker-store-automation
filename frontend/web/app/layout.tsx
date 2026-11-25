import type { Metadata } from 'next';
import { Bodoni_Moda, Pixelify_Sans, Black_Ops_One } from 'next/font/google';
import './globals.css';
import { CartProvider } from '../context/CartContext';

const bodoniModa = Bodoni_Moda({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-bodoni-moda',
  display: 'swap',
  adjustFontFallback: false,
});

const pixelifySans = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pixelify-sans',
  display: 'swap',
});

const blackOpsOne = Black_Ops_One({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-black-ops-one',
  display: 'swap',
});

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
    <html
      lang="en"
      className={`${bodoniModa.variable} ${pixelifySans.variable} ${blackOpsOne.variable}`}
    >
      <body className={`${bodoniModa.variable} ${pixelifySans.variable} ${blackOpsOne.variable}`}>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
