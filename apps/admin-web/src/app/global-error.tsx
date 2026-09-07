'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { readonly error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <h1>CarShare Admin encountered an unexpected error.</h1>
        <p>Please reload and try again.</p>
      </body>
    </html>
  );
}
