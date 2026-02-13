import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterOption[];
  multiSelectFilters?: MultiSelectFilterOption[];
  onFilterChange?: (filterId: string, value: string) => void;
  onMultiSelectFilterChange?: (filterId: string, values: string[]) => void;
  customFilters?: React.ReactNode;
  /** Badges informativos adicionales (ej: móviles seleccionados) */
  infoBadges?: { label: string; color?: string; onClear?: () => void }[];
}

interface FilterOption {
  id: string;
  label: string;
  icon?: string;
  options: { value: string; label: string }[];
  value: string;
}

interface MultiSelectFilterOption {
  id: string;
  label: string;
  icon?: string;
  options: { value: string; label: string; color?: string }[];
  values: string[];
}

export default function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar...',
  filters = [],
  multiSelectFilters = [],
  onFilterChange,
  onMultiSelectFilterChange,
  customFilters,
  infoBadges = [],
}: FilterBarProps) {
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  return (
    <>
      <div className="space-y-2">
        {/* Barra de búsqueda con botón de filtros */}
        <div className="flex gap-2">
          {/* Buscador */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full px-4 py-2 pl-10 pr-10 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-sm"
            />
            <svg 
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchValue && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Botón de filtros (solo si hay filtros disponibles O customFilters) */}
          {(filters.length > 0 || multiSelectFilters.length > 0 || customFilters) && (
            <button
              onClick={() => setShowFiltersModal(!showFiltersModal)}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-lg transition-colors relative"
              title="Filtros"
            >
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {/* Badge indicador de filtros activos */}
              {(filters.some(f => f.value !== 'all' && f.value !== '') || multiSelectFilters.some(f => f.values.length > 0)) && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
              )}
            </button>
          )}
        </div>

        {/* Panel de filtros desplegable */}
        <AnimatePresence>
          {showFiltersModal && (filters.length > 0 || multiSelectFilters.length > 0 || customFilters) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-700">Filtros</h4>
                  <button
                    onClick={() => setShowFiltersModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {filters.map((filter) => (
                  <div key={filter.id} className="space-y-1">
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      {filter.icon && <span>{filter.icon}</span>}
                      {filter.label}
                    </label>
                    <select
                      value={filter.value}
                      onChange={(e) => onFilterChange?.(filter.id, e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none bg-white"
                    >
                      {filter.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                
                {/* Filtros multi-selección (checkboxes) */}
                {multiSelectFilters.map((filter) => (
                  <div key={filter.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                        {filter.icon && <span>{filter.icon}</span>}
                        {filter.label}
                      </label>
                      {filter.values.length > 0 && (
                        <button
                          onClick={() => onMultiSelectFilterChange?.(filter.id, [])}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1">
                      {filter.options.map((option) => {
                        const isSelected = filter.values.includes(option.value);
                        return (
                          <label
                            key={option.value}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs ${
                              isSelected 
                                ? 'bg-blue-50 border border-blue-300' 
                                : 'bg-white border border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const newValues = isSelected
                                  ? filter.values.filter(v => v !== option.value)
                                  : [...filter.values, option.value];
                                onMultiSelectFilterChange?.(filter.id, newValues);
                              }}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            {option.color && (
                              <span 
                                className="w-3 h-3 rounded-full flex-shrink-0" 
                                style={{ backgroundColor: option.color }}
                              />
                            )}
                            <span className="text-gray-700">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Contenido personalizado de filtros */}
                {customFilters}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Indicadores de búsqueda/filtros activos */}
        {(searchValue || filters.some(f => f.value !== 'all' && f.value !== '') || multiSelectFilters.some(f => f.values.length > 0) || infoBadges.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {searchValue && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                Búsqueda: &quot;{searchValue}&quot;
              </span>
            )}
            {infoBadges.map((badge, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${badge.color || 'bg-indigo-100 text-indigo-700'}`}>
                {badge.label}
                {badge.onClear && (
                  <button onClick={badge.onClear} className="ml-0.5 hover:opacity-70">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            ))}
            {filters
              .filter(f => f.value !== 'all' && f.value !== '')
              .map(f => {
                const selectedOption = f.options.find(opt => opt.value === f.value);
                return (
                  <span key={f.id} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                    {f.label}: {selectedOption?.label}
                  </span>
                );
              })}
            {multiSelectFilters
              .filter(f => f.values.length > 0)
              .map(f => (
                <span key={f.id} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                  {f.label}: {f.values.map(v => f.options.find(o => o.value === v)?.label).join(', ')}
                </span>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
