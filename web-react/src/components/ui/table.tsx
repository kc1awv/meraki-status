import React from 'react'
export const Table = (p: React.HTMLAttributes<HTMLTableElement>) => <table className={`w-full border-collapse ${p.className || ''}`} {...p} />
export const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />
export const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />
export const TableRow = (p: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={`border-t ${p.className || ''}`} {...p} />
export const TableHead = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={`bg-slate-50 text-left text-sm font-semibold ${p.className || ''}`} {...p} />
export const TableCell = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={`p-3 align-middle ${p.className || ''}`} {...p} />