import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'


type SlaRow = {
    office: string
    sec_up: number
    sec_deg: number
    sec_down: number
    sec_total: number
    uptime_strict: number
    uptime_lenient: number
}

type SlaResponse = {
    window: { t_start: number; t_end: number }
    sla: SlaRow[]
}

type RangeOption = {
    value: '24h' | '7d' | '30d'
    label: string
    seconds: number
}


const RANGE_OPTIONS: RangeOption[] = [
    { value: '24h', label: 'Last 24 hours', seconds: 24 * 60 * 60 },
    { value: '7d', label: 'Last 7 days', seconds: 7 * 24 * 60 * 60 },
    { value: '30d', label: 'Last 30 days', seconds: 30 * 24 * 60 * 60 },
]


const stateBadgeVariant = (row: SlaRow) => {
    if (row.sec_down > 0) {
        return { variant: 'destructive' as const, label: 'Down' }
    }
    if (row.sec_deg > 0) {
        return { variant: 'secondary' as const, label: 'Degraded' }
    }
    return { variant: 'default' as const, label: 'Up' }
}


const formatPercent = (value: number) => `${(value * 100).toFixed(3)}%`


const formatDuration = (seconds: number) => {
    const total = Math.round(seconds)
    if (total <= 0) {
        return '0s'
    }
    const units = [
        { label: 'd', value: 86400 },
        { label: 'h', value: 3600 },
        { label: 'm', value: 60 },
        { label: 's', value: 1 },
    ]
    const parts: string[] = []
    let remainder = total
    for (const unit of units) {
        if (remainder >= unit.value) {
            const qty = Math.floor(remainder / unit.value)
            parts.push(`${qty}${unit.label}`)
            remainder %= unit.value
        }
        if (parts.length === 2) {
            break
        }
    }
    return parts.join(' ')
}


const formatWindow = (window: SlaResponse['window']) => {
    const start = new Date(window.t_start * 1000)
    const end = new Date(window.t_end * 1000)
    return `${start.toLocaleString()} – ${end.toLocaleString()}`
}


const MerakiStatusDashboard: React.FC = () => {
    const [range, setRange] = useState<RangeOption['value']>('24h')
    const [office, setOffice] = useState<string>('all')
    const [data, setData] = useState<SlaResponse | null>(null)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [knownOffices, setKnownOffices] = useState<string[]>([])

    const refresh = useCallback(async () => {
        const selectedRange = RANGE_OPTIONS.find((item) => item.value === range) ?? RANGE_OPTIONS[0]
        const now = Math.floor(Date.now() / 1000)
        const t_end = now
        const t_start = now - selectedRange.seconds
        const params = new URLSearchParams({ t_start: String(t_start), t_end: String(t_end) })
        if (office !== 'all') {
            params.set('office', office)
        }

        setLoading(true)
        setError(null)
        try {
            const resp = await fetch(`/api/sla?${params.toString()}`)
            if (!resp.ok) {
                throw new Error(`API request failed with status ${resp.status}`)
            }
            const json: SlaResponse = await resp.json()
            setData(json)
            const officesFromResponse = json.sla.map((row) => row.office)
            setKnownOffices((prev) => {
                const merged = Array.from(new Set([...prev, ...officesFromResponse])).sort((a, b) => a.localeCompare(b))
                return merged.length === prev.length && merged.every((name, idx) => name === prev[idx]) ? prev : merged
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [office, range])

    useEffect(() => {
        refresh()
    }, [refresh])

    useEffect(() => {
        const interval = setInterval(refresh, 60_000)
        return () => clearInterval(interval)
    }, [refresh])

    const rows = data?.sla ?? []

    const sortedRows = useMemo(() => {
        const getStatePriority = (row: SlaRow) => {
            if (row.sec_down > 0) {
                return 0
            }
            if (row.sec_deg > 0) {
                return 1
            }
            return 2
        }

        return [...rows].sort((a, b) => {
            const priorityDiff = getStatePriority(a) - getStatePriority(b)
            if (priorityDiff !== 0) {
                return priorityDiff
            }
            return a.office.localeCompare(b.office)
        })
    }, [rows])

    const summary = useMemo(() => {
        if (!rows.length) {
            return null
        }
        const totals = rows.reduce(
            (acc, row) => {
                acc.up += row.sec_up
                acc.deg += row.sec_deg
                acc.down += row.sec_down
                acc.total += row.sec_total
                return acc
            },
            { up: 0, deg: 0, down: 0, total: 0 }
        )
        const denominator = totals.total || 1
        return {
            strict: totals.up / denominator,
            lenient: (totals.up + totals.deg) / denominator,
            downtime: totals.down,
            offices: rows.length,
        }
    }, [rows])

    const windowLabel = data ? formatWindow(data.window) : null
    const officeOptions = useMemo(() => {
        const current = rows.map((row) => row.office)
        const merged = Array.from(new Set([...knownOffices, ...current, office !== 'all' ? office : null].filter(Boolean) as string[]))
        return merged.sort((a, b) => a.localeCompare(b))
    }, [knownOffices, rows, office])

    return (
        <div className="min-h-screen bg-slate-100 py-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4">
                <header className="flex flex-col gap-2">
                    <h1 className="text-3xl font-semibold text-slate-900">NACA Office Network Health</h1>
                    <p className="text-slate-600">
                        Live office availability and latency summary
                    </p>
                </header>

                <Card>
                    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <CardTitle>SLA</CardTitle>
                            <CardDescription>
                                {windowLabel ? `Window: ${windowLabel}` : 'Select a range to view recent uptime.'}
                            </CardDescription>
                        </div>
                        <div className="flex flex-col gap-3 text-sm text-slate-600 md:flex-row md:items-center">
                            <label className="flex flex-col gap-1">
                                <span className="font-medium">Time range</span>
                                <select
                                    value={range}
                                    onChange={(event) => setRange(event.target.value as RangeOption['value'])}
                                    className="input"
                                >
                                    {RANGE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="font-medium">Office</span>
                                <select value={office} onChange={(event) => setOffice(event.target.value)} className="input">
                                    <option value="all">All offices</option>
                                    {officeOptions.map((name) => (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button onClick={refresh} className="btn self-start md:self-end" disabled={loading}>
                                {loading ? 'Refreshing…' : 'Refresh'}
                            </button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {error && <div className="text-sm text-rose-600">{error}</div>}
                        {!error && loading && !rows.length && (
                            <div className="text-sm text-slate-500">Loading the latest SLA data…</div>
                        )}
                        {summary && (
                            <div className="grid gap-4 md:grid-cols-3">
                                <SummaryStat label="Strict uptime" value={formatPercent(summary.strict)} />
                                <SummaryStat label="Lenient uptime" value={formatPercent(summary.lenient)} />
                                <SummaryStat label="Total downtime" value={formatDuration(summary.downtime)} />
                            </div>
                        )}
                        {!loading && !error && !rows.length && (
                            <div className="text-sm text-slate-500">No SLA data is available for the selected filters.</div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Office status breakdown</CardTitle>
                        <CardDescription>
                            View uptime and downtime distribution for each location.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="p-3">Office</TableHead>
                                    <TableHead className="p-3">Current state</TableHead>
                                    <TableHead className="p-3">Strict uptime</TableHead>
                                    <TableHead className="p-3">Lenient uptime</TableHead>
                                    <TableHead className="p-3">Degraded</TableHead>
                                    <TableHead className="p-3">Down</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedRows.map((row) => {
                                    const badge = stateBadgeVariant(row)
                                    return (
                                        <TableRow key={row.office}>
                                            <TableCell className="p-3 font-medium text-slate-900">{row.office}</TableCell>
                                            <TableCell className="p-3">
                                                <Badge variant={badge.variant}>{badge.label}</Badge>
                                            </TableCell>
                                            <TableCell className="p-3 font-mono text-sm">{formatPercent(row.uptime_strict)}</TableCell>
                                            <TableCell className="p-3 font-mono text-sm">{formatPercent(row.uptime_lenient)}</TableCell>
                                            <TableCell className="p-3 text-sm text-slate-600">{formatDuration(row.sec_deg)}</TableCell>
                                            <TableCell className="p-3 text-sm text-slate-600">{formatDuration(row.sec_down)}</TableCell>
                                        </TableRow>
                                    )
                                })}
                                {!rows.length && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="p-6 text-center text-sm text-slate-500">
                                            {loading ? 'Loading results…' : 'No results to display.'}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}


type SummaryStatProps = {
    label: string
    value: string
}


const SummaryStat: React.FC<SummaryStatProps> = ({ label, value }) => (
    <div className="card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
)


export default MerakiStatusDashboard