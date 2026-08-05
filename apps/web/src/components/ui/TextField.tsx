import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface FieldShellProps {
  label?: string;
  support?: ReactNode;
  error?: boolean;
  className?: string;
  children: ReactNode;
}

function FieldShell({ label, support, error, className = '', children }: FieldShellProps) {
  return (
    <label className={`md-field${error ? ' md-field-error' : ''}${className ? ` ${className}` : ''}`}>
      {label && <span className="md-field-label">{label}</span>}
      {children}
      {support != null && <span className="md-field-support">{support}</span>}
    </label>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  support?: ReactNode;
  error?: boolean;
  containerClassName?: string;
}

export function TextField({
  label,
  support,
  error,
  containerClassName = '',
  className = '',
  ...rest
}: TextFieldProps) {
  return (
    <FieldShell label={label} support={support} error={error} className={containerClassName}>
      <input className={`md-field-input${className ? ` ${className}` : ''}`} {...rest} />
    </FieldShell>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  support?: ReactNode;
  error?: boolean;
  containerClassName?: string;
}

export function SelectField({
  label,
  support,
  error,
  containerClassName = '',
  className = '',
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} support={support} error={error} className={containerClassName}>
      <select className={`md-field-select${className ? ` ${className}` : ''}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export default TextField;
