import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accepted for API compatibility; cards are flat, no glow. */
  glow?: 'accent' | 'critical' | 'warning' | 'success' | 'none';
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  interactive = false,
  className = '',
  style,
  ...props
}) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderRadius: '12px',
        transition: 'border-color 0.15s ease',
        cursor: interactive ? 'pointer' : 'default',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
      className={`surface-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  style,
  className = '',
  ...props
}) => (
  <div
    style={{
      padding: '20px',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      ...style,
    }}
    className={className}
    {...props}
  >
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  style,
  className = '',
  ...props
}) => (
  <h3
    style={{
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--text-primary)',
      letterSpacing: 0,
      margin: 0,
      ...style,
    }}
    className={className}
    {...props}
  >
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  style,
  className = '',
  ...props
}) => (
  <p
    style={{
      fontSize: '13px',
      color: 'var(--text-muted)',
      marginTop: '4px',
      margin: 0,
      ...style,
    }}
    className={className}
    {...props}
  >
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  style,
  className = '',
  ...props
}) => (
  <div
    style={{
      padding: '20px',
      flex: 1,
      ...style,
    }}
    className={className}
    {...props}
  >
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  style,
  className = '',
  ...props
}) => (
  <div
    style={{
      padding: '16px 20px',
      borderTop: '1px solid var(--border-subtle)',
      backgroundColor: 'var(--surface-elevated)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      ...style,
    }}
    className={className}
    {...props}
  >
    {children}
  </div>
);
