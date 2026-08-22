import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MintCopyBadgeProps {
  mint: string;
  label?: string;
  className?: string;
  startChars?: number;
  endChars?: number;
  size?: 'sm' | 'md' | 'lg';
  showCopiedText?: boolean;
}

export const MintCopyBadge: React.FC<MintCopyBadgeProps> = ({
  mint,
  label,
  className = '',
  startChars = 4,
  endChars = 4,
  size = 'md',
  showCopiedText = true
}) => {
  const [copied, setCopied] = useState(false);

  if (!mint) return null;

  const formattedAddress = mint.length > (startChars + endChars + 3)
    ? `${mint.slice(0, startChars)}...${mint.slice(-endChars)}`
    : mint;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-[11px] px-2.5 py-1 gap-1.5',
    lg: 'text-xs px-3 py-1.5 gap-2'
  }[size];

  const iconSizes = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
    lg: 'w-3.5 h-3.5'
  }[size];

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard!' : `Copy ${mint}`}
      className={`inline-flex items-center font-mono rounded-full border transition-all cursor-pointer select-none group shrink-0 ${sizeClasses} ${
        copied
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
          : 'bg-[#10111a] hover:bg-[#1f212e] text-[#94a3b8] hover:text-white border-[#2d2e3d] hover:border-[#474a61]'
      } ${className}`}
    >
      {copied ? (
        <>
          <Check className={`${iconSizes} text-emerald-400 shrink-0 animate-scaleIn`} />
          {showCopiedText && (
            <span className="font-sans font-bold text-emerald-400 text-[10px] uppercase tracking-wider">
              Copied!
            </span>
          )}
        </>
      ) : (
        <>
          {label && <span className="font-sans text-[#64748b] group-hover:text-slate-400 font-medium">{label}</span>}
          <span className="font-semibold">{formattedAddress}</span>
          <Copy className={`${iconSizes} text-[#64748b] group-hover:text-slate-200 transition-colors shrink-0 ml-0.5`} />
        </>
      )}
    </button>
  );
};
