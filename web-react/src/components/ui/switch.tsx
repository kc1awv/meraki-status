import * as SwitchPrimitives from '@radix-ui/react-switch'
import React from 'react'


export function Switch({ className = '', ...props }: React.ComponentProps<typeof SwitchPrimitives.Root>) {
    return (
        <SwitchPrimitives.Root className={`inline-flex h-6 w-11 items-center rounded-full bg-slate-300 data-[state=checked]:bg-emerald-500 transition-colors ${className}`} {...props}>
            <SwitchPrimitives.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
        </SwitchPrimitives.Root>
    )
}