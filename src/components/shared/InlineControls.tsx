import React, { type ButtonHTMLAttributes, type ChangeEvent, type ReactNode } from 'react';

// Themed control primitives for inline interactive islands. They keep the control
// row visually consistent across the site without imposing a heavy panel: a
// horizontal, wrapping bar of labelled sliders, toggles, and buttons. Native
// range/checkbox inputs inherit the theme accent color (see global.css).

interface ControlBarProps {
  children: ReactNode;
  align?: 'center' | 'start';
  className?: string;
}

export function ControlBar({ children, align = 'center', className = '' }: ControlBarProps) {
  const justify = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${justify} text-[var(--text-primary)] ${className}`.trim()}>
      {children}
    </div>
  );
}

interface SliderProps {
  label: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: ReactNode;
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({ label, min, max, value, onChange, step = 1, unit, format, disabled = false }: SliderProps) {
  const display = format ? format(value) : String(value);
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`.trim()}>
      <span className="font-medium">
        {label}
        {unit ? <span className="text-[var(--text-muted)]"> ({unit})</span> : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        className="accent-[var(--accent-blue)]"
      />
      <span className="inline-block min-w-[3ch] text-left font-mono tabular-nums">{display}</span>
    </label>
  );
}

interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="inline-flex select-none items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        className="accent-[var(--accent-blue)]"
      />
      {label}
    </label>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base = variant === 'secondary' ? 'btn btn-secondary' : 'btn';
  return <button className={`${base} ${className}`.trim()} {...rest} />;
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}

export function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      {label ? <span className="font-medium">{label}</span> : null}
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        className="rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-[var(--text-primary)]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
