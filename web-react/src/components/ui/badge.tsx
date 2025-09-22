import React from 'react'
export function Badge({ variant = 'outline', className = '', ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'outline' | 'secondary' | 'destructive' | 'default' }) {
    const map: Record<string, string> = {
        outline: 'badge',
        secondary: 'badge badge-deg',
        destructive: 'badge badge-down',
        default: 'badge badge-up'
    }
    return <span className={`${map[variant] || 'badge'} ${className}`} {...props} />
}