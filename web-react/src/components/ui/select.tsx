import * as SelectPrimitives from '@radix-ui/react-select'
import React from 'react'


export const Select = ({ value, onValueChange, children }: { value: string, onValueChange: (v: string) => void, children: React.ReactNode }) => (
    <SelectPrimitives.Root value={value} onValueChange={onValueChange}>{children}</SelectPrimitives.Root>
)
export const SelectTrigger = ({ className = '', ...props }: React.ComponentProps<'button'>) => (
    <SelectPrimitives.Trigger className={`input flex items-center justify-between ${className}`} {...props} />
)
export const SelectValue = (props: any) => <SelectPrimitives.Value {...props} />
export const SelectContent = ({ className = '', ...props }: React.ComponentProps<typeof SelectPrimitives.Content>) => (
    <SelectPrimitives.Portal>
        <SelectPrimitives.Content className={`rounded-xl border border-slate-200 bg-white p-1 shadow ${className}`} {...props} />
    </SelectPrimitives.Portal>
)
export const SelectItem = ({ className = '', children, value }: { className?: string, children: React.ReactNode, value: string }) => (
    <SelectPrimitives.Item value={value} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 ${className}`}>
        <SelectPrimitives.ItemText>{children}</SelectPrimitives.ItemText>
    </SelectPrimitives.Item>
)