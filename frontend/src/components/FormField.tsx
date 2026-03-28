import React, { useState, useId } from 'react';
import { EyeIcon, EyeSlashIcon, ExclamationCircleIcon } from '@patternfly/react-icons';

interface FormFieldProps {
  label: string;
  helperText?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

export function FormField({ label, helperText, required, error, children }: FormFieldProps) {
  const id = useId();
  return (
    <div className="aap-form-group">
      <label className="aap-form-group__label" htmlFor={id}>
        {label}
        {required && <span className="aap-form-group__required" aria-hidden="true">*</span>}
      </label>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              id,
              'aria-required': required || undefined,
              'aria-invalid': error ? true : undefined,
              'aria-describedby': error ? `${id}-error` : helperText ? `${id}-helper` : undefined,
            })
          : child,
      )}
      {error && (
        <div className="aap-form-group__error" id={`${id}-error`} role="alert">
          <ExclamationCircleIcon /> {error}
        </div>
      )}
      {helperText && !error && (
        <div className="aap-form-group__helper" id={`${id}-helper`}>{helperText}</div>
      )}
    </div>
  );
}

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  mono?: boolean;
}

export function TextInput({ value, onChange, type = 'text', error, mono, className = '', ...rest }: TextInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const resolvedType = isPassword && showPassword ? 'text' : type;

  if (isPassword) {
    return (
      <div className="aap-input-group">
        <input
          type={resolvedType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`aap-input ${mono ? 'aap-input--mono' : ''} ${error ? 'aap-input--error' : ''} ${className}`}
          autoComplete="off"
          spellCheck={false}
          {...rest}
        />
        <button
          type="button"
          className="aap-input-group__toggle"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  }

  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`aap-input ${mono ? 'aap-input--mono' : ''} ${error ? 'aap-input--error' : ''} ${className}`}
      autoComplete="off"
      spellCheck={false}
      {...rest}
    />
  );
}

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function NumberInput({ value, onChange, min, max, disabled, ...rest }: NumberInputProps) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(isNaN(n) ? (min ?? 0) : n);
      }}
      min={min}
      max={max}
      disabled={disabled}
      className="aap-input"
      {...rest}
    />
  );
}

interface SwitchInputProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function SwitchInput({ checked, onChange, label, disabled }: SwitchInputProps) {
  const id = useId();
  return (
    <div
      className={`aap-switch ${checked ? 'aap-switch--on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? `${id}-label` : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }
      }}
    >
      <div className="aap-switch__track">
        <div className="aap-switch__thumb" />
      </div>
      {label && <span id={`${id}-label`} className="aap-switch__label">{label}</span>}
    </div>
  );
}
