// Minimal placeholders; not used heavily but kept to satisfy imports
import React from 'react'
export const Tabs = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
export const TabsList = ({ children }: { children: React.ReactNode }) => <div className="inline-flex rounded-xl border p-1">{children}</div>
export const TabsTrigger = ({ children }: { children: React.ReactNode }) => <button className="btn">{children}</button>
export const TabsContent = ({ children }: { children: React.ReactNode }) => <div className="mt-2">{children}</div>