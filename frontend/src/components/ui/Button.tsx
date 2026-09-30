import React, { useState } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'gradient';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  isLoading = false,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getVariantStyles = (): React.CSSProperties => {
    if (disabled) {
      return {
        backgroundColor: 'var(--surface-elevated)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-muted)',
        cursor: 'not-allowed',
        opacity: 0.6,
      };
    }

    switch (variant) {
      case 'primary':
        // Solid single accent. No gradient, no glow.
        return {
          backgroundColor: isHovered ? 'var(--accent-hover)' : 'var(--accent)',
          borderColor: isHovered ? 'var(--accent-hover)' : 'var(--accent)',
          color: 'var(--text-inverse)',
          fontWeight: 500,
        };
      case 'outline':
        return {
          backgroundColor: isHovered ? 'var(--surface-hover)' : 'transparent',
          borderColor: isHovered ? 'var(--border-strong)' : 'var(--border)',
          color: 'var(--text-primary)',
        };
      case 'danger':
        return {
          backgroundColor: isHovered ? 'var(--danger)' : 'transparent',
          borderColor: isHovered ? 'var(--danger)' : 'var(--danger-border)',
          color: isHovered ? '#ffffff' : 'var(--danger-text)',
        };
      case 'ghost':
        return {
          backgroundColor: isHovered ? 'var(--surface-hover)' : 'transparent',
          borderColor: 'transparent',
          color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
        };
      case 'gradient':
        // Legacy visual variant kept for API compatibility — renders as the
        // solid primary button (single accent, no gradient, no glow).
        return {
          backgroundColor: isHovered ? 'var(--accent-hover)' : 'var(--accent)',
          borderColor: isHovered ? 'var(--accent-hover)' : 'var(--accent)',
          color: 'var(--text-inverse)',
          fontWeight: 500,
        };
      case 'secondary':
      default:
        // White plate with a green hairline — the quiet counterpart to primary.
        return {
          backgroundColor: isHovered ? 'var(--surface-hover)' : 'var(--surface)',
          borderColor: isHovered ? 'var(--accent)' : 'var(--accent-border)',
          color: 'var(--accent-text)',
          fontWeight: 500,
        };
    }
  };

  const getSizeStyles = (): React.CSSProperties => {
    switch (size) {
      case 'sm':
        return {
          padding: '6px 12px',
          fontSize: '13px',
          borderRadius: '8px',
          gap: '6px',
        };
      case 'lg':
        return {
          padding: '12px 16px',
          fontSize: '14px',
          borderRadius: '9px',
          gap: '8px',
        };
      case 'md':
      default:
        return {
          padding: '8px 16px',
          fontSize: '14px',
          borderRadius: '9px',
          gap: '8px',
        };
    }
  };

  return (
    <button
      disabled={disabled || isLoading}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: '1px',
        borderStyle: 'solid',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...getSizeStyles(),
        ...getVariantStyles(),
        ...style,
      }}
      className={`font-medium ${className}`}
      {...props}
    >
      {isLoading ? (
        <span
          style={{
            width: '14px',
            height: '14px',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'radar-sweep 0.8s linear infinite',
          }}
        />
      ) : (
        icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>
      )}
      {children}
      {iconRight && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{iconRight}</span>}
    </button>
  );
};
