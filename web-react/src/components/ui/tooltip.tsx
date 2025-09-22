import * as Tooltip from '@radix-ui/react-tooltip'
import React from 'react'


export const TooltipProvider = Tooltip.Provider
export const TooltipTrigger = Tooltip.Trigger
export function TooltipContent({ className = '', ...props }: React.ComponentProps<typeof Tooltip.Content>) {
    return (
        <Tooltip.Portal>
            <Tooltip.Content sideOffset={6} className={`rounded-md bg-black px-2 py-1 text-xs text-white shadow ${className}`} {...props} />
        </Tooltip.Portal>
    )
}