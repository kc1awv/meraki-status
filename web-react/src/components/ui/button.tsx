import React from 'react'


export function Button({ variant = 'default', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'secondary' | 'ghost' }) {
    const base = 'btn';
    const map: Record<string, string> = {
        default: '',
        outline: '',
        secondary: 'bg-slate-100',
        ghost: 'btn-ghost'
    }
    return <button className={`${base} ${map[variant] || ''} ${className}`} {...props} />
}