import React, { useMemo } from 'react'
import { feature } from 'topojson-client'
import type { FeatureCollection } from 'geojson'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'

import statesTopology from '../data/us-states-10m.json'

export type OfficeStatus = 'up' | 'degraded' | 'down'

export type OfficePoint = {
    name: string
    status: OfficeStatus
}

const OFFICE_COORDINATES: Record<string, [number, number]> = {
    Boston: [-71.0589, 42.3601],
    Atlanta: [-84.388, 33.749],
    Augusta: [-82.0105, 33.4735],
    Baltimore: [-76.6122, 39.2904],
    'Baton Rouge': [-91.1403, 30.4515],
    Birmingham: [-86.8025, 33.5186],
    Buffalo: [-78.8784, 42.8864],
    Charlotte: [-80.8431, 35.2271],
    'Counseling Center': [-77.0369, 38.9072],
    Chicago: [-87.6298, 41.8781],
    Cleveland: [-81.6944, 41.4993],
    Columbia: [-81.0348, 34.0007],
    Dallas: [-96.797, 32.7767],
    Detroit: [-83.0458, 42.3314],
    Hartford: [-72.6851, 41.7637],
    Houston: [-95.3698, 29.7604],
    Jackson: [-90.1848, 32.2988],
    Jacksonville: [-81.6557, 30.3322],
    'Kansas City': [-94.5786, 39.0997],
    'Las Vegas': [-115.1398, 36.1699],
    'Little Rock': [-92.2896, 34.7465],
    'Los Angeles': [-118.2437, 34.0522],
    Memphis: [-90.049, 35.1495],
    Milwaukee: [-87.9065, 43.0389],
    Minneapolis: [-93.265, 44.9778],
    'New Orleans': [-90.0715, 29.9511],
    Newark: [-74.1724, 40.7357],
    'North Charleston': [-79.9748, 32.8774],
    Orlando: [-81.3792, 28.5383],
    Philadelphia: [-75.1652, 39.9526],
    Phoenix: [-112.074, 33.4484],
    Raleigh: [-78.6382, 35.7796],
    Richmond: [-77.436, 37.5407],
    Rochester: [-77.6109, 43.1566],
    Sacramento: [-121.4944, 38.5816],
    'San Antonio': [-98.4936, 29.4241],
    'St. Louis': [-90.1994, 38.627],
    Tampa: [-82.4572, 27.9506],
    Upland: [-117.6484, 34.0975],
    'Washington DC': [-77.0369, 38.9072],
}

const STATUS_COLORS: Record<OfficeStatus, string> = {
    up: '#22c55e',
    degraded: '#facc15',
    down: '#ef4444',
}

const STATUS_LABELS: Record<OfficeStatus, string> = {
    up: 'Up',
    degraded: 'Degraded',
    down: 'Down',
}

const statesFeatures = feature(statesTopology as any, (statesTopology as any).objects.states) as FeatureCollection

const OfficeMap: React.FC<{ offices: OfficePoint[] }> = ({ offices }) => {
    const markers = useMemo(() => {
        return offices
            .map((office) => {
                const coordinates = OFFICE_COORDINATES[office.name]
                if (!coordinates) {
                    return null
                }
                return { ...office, coordinates }
            })
            .filter((item): item is OfficePoint & { coordinates: [number, number] } => Boolean(item))
    }, [offices])

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
                <div className="aspect-[16/7] w-full">
                    <ComposableMap
                        projection="geoAlbersUsa"
                        projectionConfig={{ scale: 1000 }}
                        width={800}
                        height={500}
                        style={{ width: '100%', height: '100%' }}
                    >
                    <Geographies geography={statesFeatures}>
                        {({ geographies }) =>
                            geographies.map((geo) => (
                                <Geography
                                    key={geo.rsmKey}
                                    geography={geo}
                                    stroke="#1e293b"
                                    strokeWidth={0.5}
                                    fill="#0f172a"
                                    style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                                />
                            ))
                        }
                    </Geographies>
                    {markers.map((marker) => (
                            <Marker key={marker.name} coordinates={marker.coordinates}>
                                <circle r={6} fill={STATUS_COLORS[marker.status]} stroke="#f8fafc" strokeWidth={1.5} />
                                <text
                                    textAnchor="middle"
                                    y={-12}
                                    className="fill-slate-200 text-[10px] font-semibold drop-shadow"
                                    style={{ pointerEvents: 'none' }}
                                >
                                    {marker.name}
                                </text>
                            </Marker>
                        ))}
                    </ComposableMap>
                </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                    <div key={status} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                        <span>{STATUS_LABELS[status as OfficeStatus]}</span>
                    </div>
                ))}
            </div>
            {!markers.length && (
                <div className="rounded-md border border-dashed border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
                    No offices available for the selected filters.
                </div>
            )}
        </div>
    )
}

export default OfficeMap