'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/* ── Types ─────────────────────────────────────────── */

interface WorkOrder {
  id: string;
  number: string;
  description: string;
  status: string;
  priority: string;
  partNumber: string;
  quantity: number;
  quantityCompleted: number;
  plannedStartDate: string;
  plannedEndDate: string;
  productionLine?: string;
}

interface Operation {
  id: string;
  workOrderId: string;
  sequenceNumber: number;
  name: string;
  status: string;
  workCenter: string;
  operator?: string;
  plannedDurationMinutes: number;
  actualDurationMinutes?: number;
}

interface QualityHold {
  id: string;
  type: string;
  referenceNumber: string;
  reason: string;
  status: string;
  holdDate: string;
}

interface InventoryItem {
  id: string;
  itemNumber: string;
  description: string;
  onHandQuantity: number;
  availableQuantity: number;
  plant: string;
  warehouse?: string;
}

type Tab = 'workorders' | 'operations' | 'quality' | 'inventory' | 'schedule';

/* ── Inner Component with useSearchParams ─────────── */

function MESPageContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'workorders';
  
  const [tab, setTab] = useState<Tab>(initialTab);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [holds, setHolds] = useState<QualityHold[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      switch (tab) {
        case 'workorders': {
          const res = await fetch('/api/enterprise/apriso?resource=workorders&pageSize=50');
          const data = await res.json();
          if (data.status === 'ok') {
            setWorkOrders(data.items || []);
          } else {
            // Demo data when API not configured
            setWorkOrders(getDemoWorkOrders());
          }
          break;
        }
        case 'operations': {
          const res = await fetch(`/api/enterprise/apriso?resource=operations${selectedWorkOrder ? `&workOrderId=${selectedWorkOrder}` : ''}`);
          const data = await res.json();
          if (data.status === 'ok') {
            setOperations(data.data || []);
          } else {
            setOperations(getDemoOperations());
          }
          break;
        }
        case 'quality': {
          const res = await fetch('/api/enterprise/apriso?resource=holds');
          const data = await res.json();
          if (data.status === 'ok') {
            setHolds(data.items || []);
          } else {
            setHolds(getDemoHolds());
          }
          break;
        }
        case 'inventory': {
          const res = await fetch('/api/enterprise/oracle?resource=inventory&plant=MAIN');
          const data = await res.json();
          if (data.status === 'ok') {
            setInventory(data.items || []);
          } else {
            setInventory(getDemoInventory());
          }
          break;
        }
      }
    } catch (err) {
      // Use demo data on error
      switch (tab) {
        case 'workorders': setWorkOrders(getDemoWorkOrders()); break;
        case 'operations': setOperations(getDemoOperations()); break;
        case 'quality': setHolds(getDemoHolds()); break;
        case 'inventory': setInventory(getDemoInventory()); break;
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('complet') || s.includes('released')) return 'bg-emerald-500/20 text-emerald-400';
    if (s.includes('progress') || s.includes('active')) return 'bg-blue-500/20 text-blue-400';
    if (s.includes('hold') || s.includes('pause')) return 'bg-amber-500/20 text-amber-400';
    if (s.includes('cancel') || s.includes('error')) return 'bg-red-500/20 text-red-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  const getPriorityColor = (priority: string) => {
    const p = priority.toLowerCase();
    if (p.includes('urgent') || p.includes('critical')) return 'text-red-400';
    if (p.includes('high')) return 'text-orange-400';
    if (p.includes('normal') || p.includes('medium')) return 'text-zinc-300';
    return 'text-zinc-500';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/enterprise" className="text-zinc-500 hover:text-white transition">←</Link>
              <span className="text-4xl">🔧</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-white">
                  Manufacturing Execution System
                </h1>
                <p className="text-zinc-500 text-sm">
                  Apriso • Oracle Manufacturing • Shop Floor Control
                </p>
              </div>
            </div>
            <button
              onClick={fetchData}
              className="px-4 py-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300"
            >
              🔄 Refresh
            </button>
          </div>
        </header>

        {/* ── Tabs ──────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {([
            ['workorders', '📋 Work Orders'],
            ['operations', '⚙️ Operations'],
            ['quality', '✅ Quality'],
            ['inventory', '📦 Inventory'],
            ['schedule', '📅 Schedule'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                tab === t 
                  ? 'bg-orange-600/30 text-orange-300 border border-orange-500/30' 
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Loading ──────────────────────────────── */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-3xl animate-pulse mb-2">⏳</div>
            <p className="text-zinc-500">Loading data...</p>
          </div>
        )}

        {/* ── Work Orders Tab ─────────────────────── */}
        {!loading && tab === 'workorders' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Work Order</th>
                  <th className="text-left py-3 px-4">Part Number</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Priority</th>
                  <th className="text-right py-3 px-4">Qty</th>
                  <th className="text-right py-3 px-4">Complete</th>
                  <th className="text-left py-3 px-4">Line</th>
                  <th className="text-left py-3 px-4">Start Date</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map(wo => (
                  <tr 
                    key={wo.id} 
                    className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition cursor-pointer"
                    onClick={() => setSelectedWorkOrder(wo.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{wo.number}</div>
                      <div className="text-[10px] text-zinc-500 truncate max-w-[200px]">{wo.description}</div>
                    </td>
                    <td className="py-3 px-4 text-cyan-400 font-mono">{wo.partNumber}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(wo.status)}`}>
                        {wo.status}
                      </span>
                    </td>
                    <td className={`py-3 px-4 font-bold ${getPriorityColor(wo.priority)}`}>
                      {wo.priority}
                    </td>
                    <td className="py-3 px-4 text-right text-zinc-300">{wo.quantity}</td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-emerald-400">{wo.quantityCompleted}</span>
                      <span className="text-zinc-600"> / {wo.quantity}</span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">{wo.productionLine || '—'}</td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {new Date(wo.plannedStartDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {workOrders.length === 0 && (
              <div className="text-center py-12 text-zinc-600">No work orders found</div>
            )}
          </div>
        )}

        {/* ── Operations Tab ──────────────────────── */}
        {!loading && tab === 'operations' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Seq</th>
                  <th className="text-left py-3 px-4">Operation</th>
                  <th className="text-left py-3 px-4">Work Center</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Operator</th>
                  <th className="text-right py-3 px-4">Planned (min)</th>
                  <th className="text-right py-3 px-4">Actual (min)</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {operations.map(op => (
                  <tr key={op.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition">
                    <td className="py-3 px-4 text-zinc-400 font-mono">{op.sequenceNumber}</td>
                    <td className="py-3 px-4 font-bold text-white">{op.name}</td>
                    <td className="py-3 px-4 text-zinc-300">{op.workCenter}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(op.status)}`}>
                        {op.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">{op.operator || '—'}</td>
                    <td className="py-3 px-4 text-right text-zinc-300">{op.plannedDurationMinutes}</td>
                    <td className="py-3 px-4 text-right text-emerald-400">{op.actualDurationMinutes ?? '—'}</td>
                    <td className="py-3 px-4 text-center">
                      <button className="px-3 py-1 rounded bg-blue-600/30 text-blue-300 text-xs hover:bg-blue-600/50 transition">
                        {op.status === 'pending' ? '▶️ Start' : op.status === 'in_progress' ? '⏸️ Pause' : '✅ Done'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {operations.length === 0 && (
              <div className="text-center py-12 text-zinc-600">Select a work order to view operations</div>
            )}
          </div>
        )}

        {/* ── Quality Tab ─────────────────────────── */}
        {!loading && tab === 'quality' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-white">Quality Holds</h3>
              <button className="px-4 py-2 rounded-xl bg-red-600/30 text-red-300 text-sm font-bold hover:bg-red-600/50 transition">
                + New Hold
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-left py-3 px-4">Reference</th>
                  <th className="text-left py-3 px-4">Reason</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Hold Date</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holds.map(hold => (
                  <tr key={hold.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition">
                    <td className="py-3 px-4 font-bold text-white capitalize">{hold.type}</td>
                    <td className="py-3 px-4 text-cyan-400 font-mono">{hold.referenceNumber}</td>
                    <td className="py-3 px-4 text-zinc-300">{hold.reason}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(hold.status)}`}>
                        {hold.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {new Date(hold.holdDate).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {hold.status === 'active' && (
                        <button className="px-3 py-1 rounded bg-emerald-600/30 text-emerald-300 text-xs hover:bg-emerald-600/50 transition">
                          Release
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Inventory Tab ───────────────────────── */}
        {!loading && tab === 'inventory' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Item Number</th>
                  <th className="text-left py-3 px-4">Description</th>
                  <th className="text-left py-3 px-4">Plant</th>
                  <th className="text-left py-3 px-4">Warehouse</th>
                  <th className="text-right py-3 px-4">On Hand</th>
                  <th className="text-right py-3 px-4">Available</th>
                  <th className="text-center py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => {
                  const isLow = item.availableQuantity < 50;
                  return (
                    <tr key={item.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition">
                      <td className="py-3 px-4 text-cyan-400 font-mono font-bold">{item.itemNumber}</td>
                      <td className="py-3 px-4 text-zinc-300">{item.description}</td>
                      <td className="py-3 px-4 text-zinc-400">{item.plant}</td>
                      <td className="py-3 px-4 text-zinc-400">{item.warehouse || '—'}</td>
                      <td className="py-3 px-4 text-right text-zinc-300">{item.onHandQuantity}</td>
                      <td className={`py-3 px-4 text-right font-bold ${isLow ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {item.availableQuantity}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isLow ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">
                            Low Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Schedule Tab (Placeholder) ──────────── */}
        {!loading && tab === 'schedule' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-12 text-center">
            <div className="text-5xl mb-4">📅</div>
            <h3 className="text-xl font-bold text-white mb-2">Production Schedule</h3>
            <p className="text-zinc-500">Gantt chart and capacity planning coming soon</p>
          </div>
        )}

        {/* ── Error Display ───────────────────────── */}
        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400 text-sm">
            ⚠️ Using demo data: {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Wrapper Component with Suspense ───────────── */

export default function MESPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🔧</div>
          <p className="text-zinc-400 animate-pulse">Loading MES...</p>
        </div>
      </div>
    }>
      <MESPageContent />
    </Suspense>
  );
}

/* ── Demo Data Functions ─────────────────────────── */

function getDemoWorkOrders(): WorkOrder[] {
  return [
    { id: '1', number: 'WO-2024-001', description: 'Assembly - Main Housing', status: 'in_progress', priority: 'high', partNumber: 'ASM-100', quantity: 100, quantityCompleted: 45, plannedStartDate: '2024-01-15', plannedEndDate: '2024-01-20', productionLine: 'Line 1' },
    { id: '2', number: 'WO-2024-002', description: 'Machining - Shaft Component', status: 'released', priority: 'normal', partNumber: 'MCH-200', quantity: 250, quantityCompleted: 0, plannedStartDate: '2024-01-16', plannedEndDate: '2024-01-22', productionLine: 'Line 2' },
    { id: '3', number: 'WO-2024-003', description: 'Welding - Frame Assembly', status: 'on_hold', priority: 'urgent', partNumber: 'WLD-300', quantity: 50, quantityCompleted: 20, plannedStartDate: '2024-01-14', plannedEndDate: '2024-01-18', productionLine: 'Line 3' },
    { id: '4', number: 'WO-2024-004', description: 'Quality Inspection', status: 'completed', priority: 'normal', partNumber: 'QC-400', quantity: 500, quantityCompleted: 500, plannedStartDate: '2024-01-10', plannedEndDate: '2024-01-12', productionLine: 'QC Station' },
    { id: '5', number: 'WO-2024-005', description: 'Final Assembly', status: 'created', priority: 'low', partNumber: 'FIN-500', quantity: 75, quantityCompleted: 0, plannedStartDate: '2024-01-20', plannedEndDate: '2024-01-25', productionLine: 'Line 1' },
  ];
}

function getDemoOperations(): Operation[] {
  return [
    { id: '1', workOrderId: '1', sequenceNumber: 10, name: 'Material Prep', status: 'completed', workCenter: 'PREP-01', operator: 'John D.', plannedDurationMinutes: 30, actualDurationMinutes: 28 },
    { id: '2', workOrderId: '1', sequenceNumber: 20, name: 'CNC Machining', status: 'in_progress', workCenter: 'CNC-02', operator: 'Sarah M.', plannedDurationMinutes: 120, actualDurationMinutes: 85 },
    { id: '3', workOrderId: '1', sequenceNumber: 30, name: 'Deburring', status: 'pending', workCenter: 'FINISH-01', plannedDurationMinutes: 45 },
    { id: '4', workOrderId: '1', sequenceNumber: 40, name: 'Quality Check', status: 'pending', workCenter: 'QC-01', plannedDurationMinutes: 20 },
    { id: '5', workOrderId: '1', sequenceNumber: 50, name: 'Packaging', status: 'pending', workCenter: 'PACK-01', plannedDurationMinutes: 15 },
  ];
}

function getDemoHolds(): QualityHold[] {
  return [
    { id: '1', type: 'material', referenceNumber: 'LOT-2024-0145', reason: 'Failed incoming inspection', status: 'active', holdDate: '2024-01-15' },
    { id: '2', type: 'work_order', referenceNumber: 'WO-2024-003', reason: 'Dimension out of spec', status: 'active', holdDate: '2024-01-14' },
    { id: '3', type: 'lot', referenceNumber: 'LOT-2024-0132', reason: 'Supplier quality issue', status: 'released', holdDate: '2024-01-10' },
  ];
}

function getDemoInventory(): InventoryItem[] {
  return [
    { id: '1', itemNumber: 'RAW-STEEL-001', description: 'Steel Bar Stock 1"', onHandQuantity: 500, availableQuantity: 450, plant: 'MAIN', warehouse: 'WH-01' },
    { id: '2', itemNumber: 'RAW-ALUM-002', description: 'Aluminum Sheet 0.5"', onHandQuantity: 200, availableQuantity: 35, plant: 'MAIN', warehouse: 'WH-01' },
    { id: '3', itemNumber: 'COMP-BEARING-100', description: 'Ball Bearing 20mm', onHandQuantity: 1000, availableQuantity: 850, plant: 'MAIN', warehouse: 'WH-02' },
    { id: '4', itemNumber: 'COMP-SEAL-200', description: 'Rubber Seal Kit', onHandQuantity: 150, availableQuantity: 25, plant: 'MAIN', warehouse: 'WH-02' },
    { id: '5', itemNumber: 'FIN-MOTOR-500', description: 'Electric Motor Assembly', onHandQuantity: 50, availableQuantity: 50, plant: 'MAIN', warehouse: 'WH-03' },
  ];
}
