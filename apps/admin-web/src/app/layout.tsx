import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/QueryProvider';
import './styles.css';

export const metadata: Metadata = {
  title: 'Car Rental Administration',
  description: 'Administrative operations for the car rental marketplace.',
};

interface RootLayoutProperties {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProperties) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
