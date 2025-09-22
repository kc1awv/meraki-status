import React from 'react'
const mergeClasses = (...classes: Array<string | undefined | null | false>) =>
    classes.filter(Boolean).join(' ')

export const Table = ({ className, ...rest }: React.HTMLAttributes<HTMLTableElement>) => (
    <table className={mergeClasses('w-full border-collapse', className)} {...rest} />
)

export const TableHeader = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />

export const TableBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />

export const TableRow = ({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className={mergeClasses('border-t border-slate-800', className)} {...rest} />
)

export const TableHead = ({ className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th
        className={mergeClasses(
            'border-b border-slate-800 bg-slate-900 text-left text-sm font-semibold text-slate-200',
            className
        )}
        {...rest}
    />
)

export const TableCell = ({ className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className={mergeClasses('p-3 align-middle', className)} {...rest} />
)