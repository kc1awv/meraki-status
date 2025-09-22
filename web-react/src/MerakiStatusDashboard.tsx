import React, { useCallback, useEffect, useMemo, useState } from 'react'
import OfficeMap, { type OfficePoint, type OfficeStatus } from './components/OfficeMap'
import { Badge } from './components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'


type KnownOfficeState = OfficeStatus | 'unknown'

type SlaRow = {
    office: string
    sec_up: number
    sec_deg: number
    sec_down: number
    sec_total: number
    uptime_strict: number
    uptime_lenient: number
    current_state?: KnownOfficeState | null
    current_at?: number | null
    previous_state?: KnownOfficeState | null
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


const badgeForState = (state: OfficeStatus) => {
    if (state === 'down') {
        return { variant: 'destructive' as const, label: 'Down' }
    }
    if (state === 'degraded') {
        return { variant: 'secondary' as const, label: 'Degraded' }
    }
    return { variant: 'default' as const, label: 'Up' }
}

const resolveCurrentState = (row: SlaRow): OfficeStatus => {
    if (row.current_state === 'down' || row.current_state === 'degraded' || row.current_state === 'up') {
        return row.current_state
    }
    if (row.sec_down > 0) {
        return 'down'
    }
    if (row.sec_deg > 0) {
        return 'degraded'
    }
    return 'up'
}

type EnrichedRow = SlaRow & {
    resolvedState: OfficeStatus
    changedAt: number | null
    previousState: KnownOfficeState | null
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


const formatRelativeTime = (seconds: number) => {
    const delta = Math.max(0, Math.round(seconds))
    if (delta <= 1) {
        return 'just now'
    }
    if (delta < 60) {
        return `${delta}s ago`
    }
    return `${formatDuration(delta)} ago`
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
    const [now, setNow] = useState<number>(() => Date.now())

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

    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1_000)
        return () => clearInterval(tick)
    }, [])

    const rows = data?.sla ?? []
    const nowSeconds = Math.floor(now / 1000)

    const enrichedRows = useMemo<EnrichedRow[]>(() => {
        return rows.map((row) => ({
            ...row,
            resolvedState: resolveCurrentState(row),
            changedAt: row.current_at ?? null,
            previousState: row.previous_state ?? null,
        }))
    }, [rows])

    const officePoints = useMemo<OfficePoint[]>(() => {
        return enrichedRows.map((row) => ({ name: row.office, status: row.resolvedState }))
    }, [enrichedRows])

    const statusRows = useMemo(() => {
        const severity: Record<OfficeStatus, number> = { down: 0, degraded: 1, up: 2 }
        return enrichedRows
            .filter((row) => {
                if (row.resolvedState !== 'up') {
                    return true
                }
                if (!row.changedAt) {
                    return false
                }
                const diff = nowSeconds - row.changedAt
                const cameFromIncident = row.previousState === 'down' || row.previousState === 'degraded'
                return cameFromIncident && diff <= 5 * 60
            })
            .sort((a, b) => {
                const severityDiff = severity[a.resolvedState] - severity[b.resolvedState]
                if (severityDiff !== 0) {
                    return severityDiff
                }
                const timeA = a.changedAt ?? 0
                const timeB = b.changedAt ?? 0
                if (timeA !== timeB) {
                    return timeB - timeA
                }
                return a.office.localeCompare(b.office)
            })
    }, [enrichedRows, nowSeconds])

    const summary = useMemo(() => {
        if (!enrichedRows.length) {
            return null
        }
        const totals = enrichedRows.reduce(
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
            offices: enrichedRows.length,
        }
    }, [enrichedRows])

    const windowLabel = data ? formatWindow(data.window) : null
    const officeOptions = useMemo(() => {
        const current = enrichedRows.map((row) => row.office)
        const merged = Array.from(new Set([...knownOffices, ...current, office !== 'all' ? office : null].filter(Boolean) as string[]))
        return merged.sort((a, b) => a.localeCompare(b))
    }, [knownOffices, enrichedRows, office])

    return (
        <div className="min-h-screen bg-slate-950 py-6 text-slate-100">
            <div className="mx-auto flex w-full max-w-full flex-col gap-6 px-4 lg:px-8">
                <header className="flex flex-col gap-2">
                    <h1 className="text-3xl font-semibold text-slate-100">NACA Office Network Health</h1>
                    <p className="text-slate-400">
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
                        <div className="flex flex-col gap-3 text-sm text-slate-400 md:flex-row md:items-center">
                            <label className="flex flex-col gap-1">
                                <span className="font-medium text-slate-200">Time range</span>
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
                                <span className="font-medium text-slate-200">Office</span>
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
                        {error && <div className="text-sm text-rose-400">{error}</div>}
                        {!error && loading && !rows.length && (
                            <div className="text-sm text-slate-400">Loading the latest SLA data…</div>
                        )}
                        {summary && (
                            <div className="grid gap-4 md:grid-cols-3">
                                <SummaryStat label="Strict uptime" value={formatPercent(summary.strict)} />
                                <SummaryStat label="Lenient uptime" value={formatPercent(summary.lenient)} />
                                <SummaryStat label="Total downtime" value={formatDuration(summary.downtime)} />
                            </div>
                        )}
                        {!loading && !error && !rows.length && (
                            <div className="text-sm text-slate-400">No SLA data is available for the selected filters.</div>
                        )}
                    </CardContent>
                </Card>

                <div className="grid gap-6 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle>Office map</CardTitle>
                            <CardDescription>Geographic view of current office health</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <OfficeMap offices={officePoints} />
                        </CardContent>
                    </Card>
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>Office status breakdown</CardTitle>
                            <CardDescription>Current operating state for each location</CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto lg:max-h-[360px] lg:overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-2/3 p-3">Office</TableHead>
                                        <TableHead className="w-1/3 p-3">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {statusRows.map((row) => {
                                        const badge = badgeForState(row.resolvedState)
                                        const changedAt = row.changedAt
                                        const detailTimestamp =
                                            typeof changedAt === 'number' ? new Date(changedAt * 1000).toLocaleString() : null
                                        const relative =
                                            typeof changedAt === 'number'
                                                ? formatRelativeTime(nowSeconds - changedAt)
                                                : null
                                        const detailLabel =
                                            row.resolvedState === 'up'
                                                ? 'Recovered at'
                                                : row.resolvedState === 'down'
                                                    ? 'Outage detected at'
                                                    : 'Degraded at'
                                        return (
                                            <TableRow key={row.office}>
                                                <TableCell className="p-3 font-medium text-slate-100">{row.office}</TableCell>
                                                <TableCell className="p-3">
                                                    <div className="flex flex-col gap-1">
                                                        <Badge variant={badge.variant}>{badge.label}</Badge>
                                                        {detailTimestamp && relative && (
                                                            <div className="text-xs text-slate-500">
                                                                {detailLabel} {detailTimestamp} ({relative})
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                    {!statusRows.length && (
                                        <TableRow>
                                            <TableCell colSpan={2} className="p-6 text-center text-sm text-slate-400">
                                                {loading ? 'Loading results…' : 'All Offices OK ☀️'}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
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
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
)


export default MerakiStatusDashboard