'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/* ── Types ─────────────────────────────────────────── */

interface BOMItem {
  id: string;
  level: number;
  partNumber: string;
  revision: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  findNumber?: string;
  substituteAllowed: boolean;
}

interface ECN {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  requestedBy: string;
  createdDate: string;
  affectedParts: number;
}

interface Document {
  id: string;
  number: string;
  title: string;
  type: string;
  revision: string;
  status: string;
  checkedOutBy?: string;
  lastModified: string;
}

interface WorkflowTask {
  id: string;
  taskType: string;
  objectNumber: string;
  objectTitle: string;
  assignedTo: string;
  dueDate: string;
  status: string;
}

type Tab = 'bom' | 'ecn' | 'documents' | 'workflows';

/* ── Inner Component with useSearchParams ─────────── */

function PLMPageContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'bom';
  
  const [tab, setTab] = useState<Tab>(initialTab);
  const [bomItems, setBomItems] = useState<BOMItem[]>([]);
  const [ecns, setEcns] = useState<ECN[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPart, setSearchPart] = useState('ASM-1000');
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set([0, 1]));

  useEffect(() => {
    fetchData();
  }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    
    // Use demo data since Windchill/NextGenPLM connectors are not yet implemented
    switch (tab) {
      case 'bom':
        setBomItems(getDemoBOM());
        break;
      case 'ecn':
        setEcns(getDemoECNs());
        break;
      case 'documents':
        setDocuments(getDemoDocuments());
        break;
      case 'workflows':
        setTasks(getDemoWorkflowTasks());
        break;
    }
    
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('approved') || s.includes('released') || s.includes('complete')) return 'bg-emerald-500/20 text-emerald-400';
    if (s.includes('review') || s.includes('pending') || s.includes('progress')) return 'bg-blue-500/20 text-blue-400';
    if (s.includes('draft') || s.includes('work')) return 'bg-amber-500/20 text-amber-400';
    if (s.includes('reject') || s.includes('cancel')) return 'bg-red-500/20 text-red-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  const toggleLevel = (level: number) => {
    const newExpanded = new Set(expandedLevels);
    if (newExpanded.has(level)) {
      newExpanded.delete(level);
    } else {
      newExpanded.add(level);
    }
    setExpandedLevels(newExpanded);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/enterprise" className="text-zinc-500 hover:text-white transition">←</Link>
              <span className="text-4xl">📐</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-white">
                  Product Lifecycle Management
                </h1>
                <p className="text-zinc-500 text-sm">
                  Windchill • NextGenPLM • BOM • Change Management
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
                🚧 Demo Mode
              </span>
              <button
                onClick={fetchData}
                className="px-4 py-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300"
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </header>

        {/* ── Tabs ──────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {([
            ['bom', '🧱 BOM Manager'],
            ['ecn', '🔄 Change Orders'],
            ['documents', '📄 Documents'],
            ['workflows', '🔀 Workflows'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                tab === t 
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30' 
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
            <p className="text-zinc-500">Loading PLM data...</p>
          </div>
        )}

        {/* ── BOM Tab ─────────────────────────────── */}
        {!loading && tab === 'bom' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="flex gap-3">
              <input
                type="text"
                value={searchPart}
                onChange={(e) => setSearchPart(e.target.value)}
                placeholder="Enter part number..."
                className="flex-1 px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
              />
              <button className="px-6 py-3 rounded-xl bg-purple-600/30 text-purple-300 font-bold hover:bg-purple-600/50 transition">
                🔍 Load BOM
              </button>
            </div>

            {/* BOM Tree */}
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="font-bold text-white">Bill of Materials — {searchPart}</h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setExpandedLevels(new Set([0, 1, 2, 3]))}
                    className="px-3 py-1 rounded bg-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-600/50"
                  >
                    Expand All
                  </button>
                  <button 
                    onClick={() => setExpandedLevels(new Set([0]))}
                    className="px-3 py-1 rounded bg-zinc-700/50 text-zinc-300 text-xs hover:bg-zinc-600/50"
                  >
                    Collapse
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                    <th className="text-left py-3 px-4">Level</th>
                    <th className="text-left py-3 px-4">Part Number</th>
                    <th className="text-left py-3 px-4">Rev</th>
                    <th className="text-left py-3 px-4">Description</th>
                    <th className="text-right py-3 px-4">Qty</th>
                    <th className="text-left py-3 px-4">UOM</th>
                    <th className="text-center py-3 px-4">Find #</th>
                    <th className="text-center py-3 px-4">Subs</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems
                    .filter(item => expandedLevels.has(item.level) || item.level === 0)
                    .map(item => (
                    <tr 
                      key={item.id} 
                      className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition cursor-pointer"
                      onClick={() => toggleLevel(item.level + 1)}
                    >
                      <td className="py-3 px-4">
                        <span 
                          className="inline-flex items-center gap-1 text-zinc-400"
                          style={{ paddingLeft: `${item.level * 20}px` }}
                        >
                          {item.level > 0 && '└'}
                          <span className="font-mono">{item.level}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-cyan-400 font-mono font-bold">{item.partNumber}</td>
                      <td className="py-3 px-4 text-zinc-400">{item.revision}</td>
                      <td className="py-3 px-4 text-zinc-300">{item.description}</td>
                      <td className="py-3 px-4 text-right text-white font-bold">{item.quantity}</td>
                      <td className="py-3 px-4 text-zinc-500">{item.unitOfMeasure}</td>
                      <td className="py-3 px-4 text-center text-zinc-400">{item.findNumber || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        {item.substituteAllowed ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ECN Tab ─────────────────────────────── */}
        {!loading && tab === 'ecn' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-white">Engineering Change Notices</h3>
              <button className="px-4 py-2 rounded-xl bg-purple-600/30 text-purple-300 text-sm font-bold hover:bg-purple-600/50 transition">
                + New ECR
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">ECN #</th>
                  <th className="text-left py-3 px-4">Title</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Priority</th>
                  <th className="text-left py-3 px-4">Requested By</th>
                  <th className="text-center py-3 px-4">Affected Parts</th>
                  <th className="text-left py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {ecns.map(ecn => (
                  <tr key={ecn.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition cursor-pointer">
                    <td className="py-3 px-4 text-purple-400 font-mono font-bold">{ecn.number}</td>
                    <td className="py-3 px-4 text-white">{ecn.title}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(ecn.status)}`}>
                        {ecn.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-300">{ecn.priority}</td>
                    <td className="py-3 px-4 text-zinc-400">{ecn.requestedBy}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded bg-zinc-700/50 text-zinc-300 text-xs">
                        {ecn.affectedParts}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {new Date(ecn.createdDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Documents Tab ───────────────────────── */}
        {!loading && tab === 'documents' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-white">Document Vault</h3>
              <div className="flex gap-2">
                <button className="px-4 py-2 rounded-xl bg-zinc-700/50 text-zinc-300 text-sm font-bold hover:bg-zinc-600/50 transition">
                  📤 Upload
                </button>
                <button className="px-4 py-2 rounded-xl bg-purple-600/30 text-purple-300 text-sm font-bold hover:bg-purple-600/50 transition">
                  + New Document
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Doc #</th>
                  <th className="text-left py-3 px-4">Title</th>
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-left py-3 px-4">Rev</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Checked Out</th>
                  <th className="text-left py-3 px-4">Modified</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition">
                    <td className="py-3 px-4 text-cyan-400 font-mono">{doc.number}</td>
                    <td className="py-3 px-4 text-white">{doc.title}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-zinc-700/50 text-zinc-300 text-xs">
                        {doc.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">{doc.revision}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(doc.status)}`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {doc.checkedOutBy ? (
                        <span className="text-amber-400">🔒 {doc.checkedOutBy}</span>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">
                      {new Date(doc.lastModified).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button className="px-3 py-1 rounded bg-blue-600/30 text-blue-300 text-xs hover:bg-blue-600/50 transition mr-1">
                        📥
                      </button>
                      <button className="px-3 py-1 rounded bg-zinc-600/30 text-zinc-300 text-xs hover:bg-zinc-500/50 transition">
                        👁️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Workflows Tab ───────────────────────── */}
        {!loading && tab === 'workflows' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
            <div className="p-4 border-b border-zinc-800">
              <h3 className="font-bold text-white">My Workflow Tasks</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left py-3 px-4">Task Type</th>
                  <th className="text-left py-3 px-4">Object</th>
                  <th className="text-left py-3 px-4">Title</th>
                  <th className="text-left py-3 px-4">Assigned To</th>
                  <th className="text-left py-3 px-4">Due Date</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-center py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => {
                  const isOverdue = new Date(task.dueDate) < new Date();
                  return (
                    <tr key={task.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 transition">
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-xs font-bold">
                          {task.taskType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-cyan-400 font-mono">{task.objectNumber}</td>
                      <td className="py-3 px-4 text-white">{task.objectTitle}</td>
                      <td className="py-3 px-4 text-zinc-400">{task.assignedTo}</td>
                      <td className={`py-3 px-4 text-xs ${isOverdue ? 'text-red-400 font-bold' : 'text-zinc-500'}`}>
                        {isOverdue && '⚠️ '}{new Date(task.dueDate).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusColor(task.status)}`}>
                          {task.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button className="px-3 py-1 rounded bg-emerald-600/30 text-emerald-300 text-xs hover:bg-emerald-600/50 transition mr-1">
                          ✓ Approve
                        </button>
                        <button className="px-3 py-1 rounded bg-red-600/30 text-red-300 text-xs hover:bg-red-600/50 transition">
                          ✗ Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Wrapper Component with Suspense ───────────── */

export default function PLMPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">📐</div>
          <p className="text-zinc-400 animate-pulse">Loading PLM...</p>
        </div>
      </div>
    }>
      <PLMPageContent />
    </Suspense>
  );
}

/* ── Demo Data Functions ─────────────────────────── */

function getDemoBOM(): BOMItem[] {
  return [
    { id: '1', level: 0, partNumber: 'ASM-1000', revision: 'A', description: 'Main Assembly', quantity: 1, unitOfMeasure: 'EA', findNumber: '1', substituteAllowed: false },
    { id: '2', level: 1, partNumber: 'SUB-1100', revision: 'B', description: 'Housing Subassembly', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.1', substituteAllowed: false },
    { id: '3', level: 2, partNumber: 'PRT-1110', revision: 'A', description: 'Main Housing', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.1.1', substituteAllowed: false },
    { id: '4', level: 2, partNumber: 'PRT-1120', revision: 'C', description: 'Cover Plate', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.1.2', substituteAllowed: true },
    { id: '5', level: 2, partNumber: 'HDW-1130', revision: 'A', description: 'M5x12 Screw', quantity: 8, unitOfMeasure: 'EA', findNumber: '1.1.3', substituteAllowed: true },
    { id: '6', level: 1, partNumber: 'SUB-1200', revision: 'A', description: 'Motor Assembly', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.2', substituteAllowed: false },
    { id: '7', level: 2, partNumber: 'MTR-1210', revision: 'B', description: 'DC Motor 24V', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.2.1', substituteAllowed: false },
    { id: '8', level: 2, partNumber: 'PRT-1220', revision: 'A', description: 'Motor Mount Bracket', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.2.2', substituteAllowed: false },
    { id: '9', level: 1, partNumber: 'SUB-1300', revision: 'A', description: 'Electronics Module', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.3', substituteAllowed: false },
    { id: '10', level: 2, partNumber: 'PCB-1310', revision: 'D', description: 'Main Control Board', quantity: 1, unitOfMeasure: 'EA', findNumber: '1.3.1', substituteAllowed: false },
  ];
}

function getDemoECNs(): ECN[] {
  return [
    { id: '1', number: 'ECN-2024-0042', title: 'Update Motor Mount Thickness', status: 'In Review', priority: 'Medium', requestedBy: 'John Smith', createdDate: '2024-01-14', affectedParts: 3 },
    { id: '2', number: 'ECN-2024-0041', title: 'Replace Obsolete Capacitor', status: 'Approved', priority: 'High', requestedBy: 'Sarah Johnson', createdDate: '2024-01-12', affectedParts: 5 },
    { id: '3', number: 'ECN-2024-0040', title: 'Add EMI Shielding', status: 'Draft', priority: 'Low', requestedBy: 'Mike Chen', createdDate: '2024-01-10', affectedParts: 2 },
    { id: '4', number: 'ECN-2024-0039', title: 'Housing Material Change', status: 'Released', priority: 'High', requestedBy: 'Lisa Wang', createdDate: '2024-01-08', affectedParts: 8 },
    { id: '5', number: 'ECN-2024-0038', title: 'Update Assembly Torque Spec', status: 'Rejected', priority: 'Medium', requestedBy: 'Tom Brown', createdDate: '2024-01-05', affectedParts: 1 },
  ];
}

function getDemoDocuments(): Document[] {
  return [
    { id: '1', number: 'DOC-ASM-1000', title: 'Main Assembly Drawing', type: 'CAD', revision: 'A', status: 'Released', lastModified: '2024-01-15' },
    { id: '2', number: 'DOC-SPEC-001', title: 'Product Requirements Spec', type: 'Spec', revision: 'B', status: 'Released', lastModified: '2024-01-10' },
    { id: '3', number: 'DOC-TEST-001', title: 'Test Procedure', type: 'Procedure', revision: 'A', status: 'In Work', checkedOutBy: 'John S.', lastModified: '2024-01-14' },
    { id: '4', number: 'DOC-QA-001', title: 'Quality Control Plan', type: 'QA', revision: 'C', status: 'Released', lastModified: '2024-01-08' },
    { id: '5', number: 'DOC-MFG-001', title: 'Manufacturing Instructions', type: 'MFG', revision: 'A', status: 'Under Review', lastModified: '2024-01-12' },
  ];
}

function getDemoWorkflowTasks(): WorkflowTask[] {
  return [
    { id: '1', taskType: 'Review', objectNumber: 'ECN-2024-0042', objectTitle: 'Update Motor Mount Thickness', assignedTo: 'You', dueDate: '2024-01-18', status: 'Pending' },
    { id: '2', taskType: 'Approve', objectNumber: 'DOC-MFG-001', objectTitle: 'Manufacturing Instructions', assignedTo: 'You', dueDate: '2024-01-16', status: 'Pending' },
    { id: '3', taskType: 'Review', objectNumber: 'PRT-1120-D', objectTitle: 'Cover Plate Rev D', assignedTo: 'You', dueDate: '2024-01-14', status: 'Overdue' },
    { id: '4', taskType: 'Sign', objectNumber: 'DOC-QA-002', objectTitle: 'Updated QC Checklist', assignedTo: 'You', dueDate: '2024-01-20', status: 'Pending' },
  ];
}
