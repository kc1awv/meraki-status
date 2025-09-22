import React from 'react'
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input className={`input ${props.className || ''}`} {...props} /> }