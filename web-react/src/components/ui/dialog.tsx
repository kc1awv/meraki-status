import * as Dialog from '@radix-ui/react-dialog'
import React from 'react'


export const DialogTrigger = Dialog.Trigger
export const DialogTitle = Dialog.Title
export const DialogDescription = Dialog.Description
export const DialogHeader = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={`p-0 ${className}`} {...props} />


export function DialogContent({ className = '', children }: React.ComponentProps<typeof Dialog.Content>) {
    return (
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/20" />
            <Dialog.Content className={`fixed left-1/2 top-1/2 w-[95vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-4 shadow-lg ${className}`}>
                {children}
            </Dialog.Content>
        </Dialog.Portal>
    )
}


export function DialogRoot(props: React.ComponentProps<typeof Dialog.Root>) { return <Dialog.Root {...props} /> }