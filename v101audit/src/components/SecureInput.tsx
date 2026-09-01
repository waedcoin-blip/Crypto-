// src/components/SecureInput.tsx
import React, { useState, forwardRef } from 'react';

interface SecureInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  validate?: (val: string) => string | null; // returns error message or null
  isBase58?: boolean; // visual hint only
  rows?: number; // for multiline (private keys)
  disabled?: boolean;
}

export const SecureInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, SecureInputProps>(
  ({ label, value, onChange, placeholder, validate, isBase58, rows = 1, disabled }, ref) => {
    const [visible, setVisible] = useState(false);
    const [touched, setTouched] = useState(false);

    const error = touched && validate ? validate(value) : null;

    const InputTag = rows > 1 ? 'textarea' : 'input';
    const inputType = rows > 1 ? undefined : visible ? 'text' : 'password';

    return (
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-medium text-gray-300 uppercase tracking-wider">
            {label}
          </label>
          {isBase58 && (
            <span className="text-[10px] text-gray-500 font-mono">
              Base58
            </span>
          )}
        </div>

        <div className="relative group">
          <InputTag
            ref={ref as any}
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows > 1 ? rows : undefined}
            className={`
              w-full rounded-[10px] border bg-[#11121c] px-3 pr-10 py-2.5
              text-[13px] text-white font-mono
              placeholder:text-gray-600
              focus:outline-none focus:ring-1 focus:ring-emerald-400
              transition-all duration-150
              ${error
                ? 'border-rose-500 focus:ring-rose-500'
                : 'border-gray-800 hover:border-gray-700'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              ${rows > 1 ? 'resize-none min-h-[80px]' : ''}
            `}
            autoComplete="off"
            spellCheck={false}
          />

          {/* Toggle visibility */}
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md
              text-gray-500 hover:text-white transition-colors cursor-pointer"
            tabIndex={-1}
          >
            {visible ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>

        {error && (
          <span className="text-[11px] text-rose-400">
            {error}
          </span>
        )}
      </div>
    );
  }
);

SecureInput.displayName = 'SecureInput';
