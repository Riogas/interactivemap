'use client';

import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';

interface MobileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Bottom-sheet genérico: slide-up desde abajo, backdrop tap cierra. z por encima
 *  del shell mobile (que es z-[10001]). */
export default function MobileSheet({ isOpen, onClose, title, children, footer }: MobileSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10060] flex flex-col justify-end bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="bg-gray-900 rounded-t-2xl border-t border-gray-700/50 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/50 flex-shrink-0">
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-white" aria-label="Cerrar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
            {footer && <div className="flex-shrink-0 px-5 py-3 border-t border-gray-700/50">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
