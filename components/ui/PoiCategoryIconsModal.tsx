'use client';
import { useState } from 'react';
import { CustomMarker } from '@/types';

interface PoiCategoryIconsModalProps {
  isOpen: boolean;
  onClose: () => void;
  poiByCategory: Array<[string, { label: string; icono: string; items: CustomMarker[] }]>;
  poiCategoryIcons: Record<string, string>;
  onSetPoiCategoryIcon: (category: string, icon: string | null) => void;
}

const POI_EMOJI_PRESETS = [
  '🏢', '🏥', '🏦', '🏨', '🏫',
  '🏙', '🏪', '🍽', '⛪', '🛒',
  '⛽', '🅿', '🏭', '📍', '⚓',
  '✈', '🚉', '🚏', '🌳', '💊',
  '🔧', '🚒', '🚓', '🏡', '🎭',
];

export default function PoiCategoryIconsModal({
  isOpen, onClose, poiByCategory, poiCategoryIcons, onSetPoiCategoryIcon,
}: PoiCategoryIconsModalProps) {
  if (!isOpen) return null;

  const editableCategories = poiByCategory.filter(([, group]) =>
    group.label.toLowerCase() !== 'punto de venta'
  );

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Iconos de Categorías POI</h2>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-lg p-1.5 transition"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {editableCategories.length === 0 ? (
            <p className="text-sm text-gray-500 italic text-center py-8">
              No hay categorías editables.
            </p>
          ) : (
            editableCategories.map(([key, group]) => (
              <CategoryRow
                key={key}
                label={group.label}
                currentIcon={poiCategoryIcons[group.label] || group.icono}
                defaultIcon={group.icono}
                itemsCount={group.items.length}
                onSelect={(icon) => onSetPoiCategoryIcon(group.label, icon)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  label,
  currentIcon,
  defaultIcon,
  itemsCount,
  onSelect,
}: {
  label: string;
  currentIcon: string;
  defaultIcon: string;
  itemsCount: number;
  onSelect: (icon: string | null) => void;
}) {
  const [customInput, setCustomInput] = useState('');

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{currentIcon}</span>
          <div>
            <div className="font-semibold text-gray-800">{label}</div>
            <div className="text-xs text-gray-500">
              {itemsCount} punto{itemsCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <button
          onClick={() => onSelect(null)}
          className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-600 hover:bg-gray-300"
          title="Resetear al ícono original"
        >
          Resetear ({defaultIcon})
        </button>
      </div>
      <div className="grid grid-cols-10 gap-1 mb-2">
        {POI_EMOJI_PRESETS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className={`text-xl p-1 rounded transition ${
              currentIcon === emoji
                ? 'bg-blue-100 ring-2 ring-blue-500'
                : 'hover:bg-gray-100'
            }`}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          maxLength={4}
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="Pegar emoji personalizado..."
          className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button
          onClick={() => {
            if (customInput.trim()) {
              onSelect(customInput.trim());
              setCustomInput('');
            }
          }}
          className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!customInput.trim()}
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
