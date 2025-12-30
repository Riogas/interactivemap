'use client';

import { Toaster } from 'react-hot-toast';

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      reverseOrder={false}
      gutter={8}
      toastOptions={{
        // Default options
        duration: 4000,
        style: {
          background: '#fff',
          color: '#363636',
          borderRadius: '12px',
          padding: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          fontSize: '14px',
          maxWidth: '500px',
        },
        // Success toast
        success: {
          duration: 3000,
          style: {
            background: '#10b981',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#10b981',
          },
        },
        // Error toast
        error: {
          duration: 4000,
          style: {
            background: '#ef4444',
            color: '#fff',
          },
          iconTheme: {
            primary: '#fff',
            secondary: '#ef4444',
          },
        },
        // Loading toast
        loading: {
          style: {
            background: '#3b82f6',
            color: '#fff',
          },
        },
      }}
    />
  );
}
