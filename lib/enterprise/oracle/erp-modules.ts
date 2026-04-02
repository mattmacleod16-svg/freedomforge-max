/* ═══════════════════════════════════════════════════════════════════════════
   Oracle ERP Module Catalog
   ═══════════════════════════════════════════════════════════════════════════
   Full public functional map of Oracle ERP modules for the Trane Enterprise
   Assistant knowledge base. Covers Financials, SCM, HCM, and Reporting.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ERPModule =
  | 'GL' | 'AP' | 'AR' | 'FA' | 'CM'           // Financials
  | 'INV' | 'PO' | 'OM' | 'MFG' | 'PLAN'       // SCM
  | 'HR' | 'PAY' | 'TL' | 'TALENT'              // HCM
  | 'OTBI' | 'BIP' | 'FRS' | 'OAC';             // Reporting

export interface ERPModuleInfo {
  id: ERPModule;
  name: string;
  suite: 'Financials' | 'SCM' | 'HCM' | 'Reporting';
  description: string;
  capabilities: string[];
  /** Key Oracle Cloud REST API resource paths */
  apiPaths?: string[];
  /** Typical integration with Apriso */
  aprisoIntegration?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Financials Modules
// ─────────────────────────────────────────────────────────────────────────────

export const FINANCIALS_MODULES: ERPModuleInfo[] = [
  {
    id: 'GL',
    name: 'General Ledger',
    suite: 'Financials',
    description:
      'The system of record for all financial transactions. Holds chart of accounts, ' +
      'journal entries, budgets, and period-close processes across legal entities.',
    capabilities: [
      'Chart of accounts with multi-segment structure',
      'Manual and automated journal entry',
      'Recurring and reversing journal templates',
      'Statistical journals for non-financial data',
      'Budget entry and real-time variance reporting',
      'Formula and statistical allocation rules',
      'Intercompany and intracompany balancing',
      'Multi-currency revaluation and translation',
      'Legal entity consolidation',
      'Period-end close with approval workflow',
      'Account reconciliation and certification',
      'GAAP and IFRS dual-ledger support',
      'Audit trail with subledger accounting entries',
    ],
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/ledgers',
      '/fscmRestApi/resources/11.13.18.05/journals',
      '/fscmRestApi/resources/11.13.18.05/generalLedgerPeriodStatuses',
    ],
  },
  {
    id: 'AP',
    name: 'Accounts Payable',
    suite: 'Financials',
    description:
      'Manages the full supplier invoice lifecycle from receipt through payment, including ' +
      'automated PO and receipt matching.',
    capabilities: [
      'Invoice entry (manual and automated/OCR import)',
      '2-way PO matching (invoice vs. PO)',
      '3-way matching (invoice vs. PO vs. receipt)',
      '4-way matching (includes inspection result)',
      'Invoice approval workflow with amount-threshold routing',
      'Prepayment and advance payment processing',
      'Payment proposals and check/ACH/wire/SEPA runs',
      'Early payment discount management',
      'Supplier master and banking details management',
      'Foreign currency invoice processing and revaluation',
      'Expense report processing',
      'Hold and release logic for problem invoices',
      'Accrual processing for uninvoiced receipts',
      'Evaluated receipt settlement (ERS / self-billing)',
    ],
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/invoices',
      '/fscmRestApi/resources/11.13.18.05/payments',
      '/fscmRestApi/resources/11.13.18.05/suppliers',
    ],
  },
  {
    id: 'AR',
    name: 'Accounts Receivable',
    suite: 'Financials',
    description:
      'Manages customer billing, receipts, collections, and revenue recognition. Integrates ' +
      'with Order Management for auto-invoicing.',
    capabilities: [
      'Customer invoice generation (manual and auto-invoice from OM)',
      'Credit memo and debit memo processing',
      'Customer receipt entry (lockbox, manual, EFT)',
      'Auto-cash application rules',
      'Unapplied and on-account receipt management',
      'Collections workbench with aging buckets',
      'Dunning letter generation',
      'Customer account statements',
      'Revenue recognition scheduling (ASC 606 / IFRS 15)',
      'Tax calculation and reporting',
      'Customer credit limit management',
      'Multi-currency receivables and revaluation',
    ],
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/receivablesInvoices',
      '/fscmRestApi/resources/11.13.18.05/receivablesReceipts',
      '/fscmRestApi/resources/11.13.18.05/customers',
    ],
  },
  {
    id: 'FA',
    name: 'Fixed Assets',
    suite: 'Financials',
    description:
      'Manages capital asset lifecycle from acquisition through depreciation and retirement, ' +
      'supporting multiple book types for GAAP, tax, and internal reporting.',
    capabilities: [
      'Asset creation from PO receipts or manual entry',
      'CIP (Construction in Progress) asset tracking',
      'Multiple depreciation methods (SL, DDB, MACRS, units of production)',
      'Multiple depreciation books (corporate, tax, AMT)',
      'Mass additions from AP invoices',
      'Asset transfers between cost centers and locations',
      'Asset reclassification',
      'Partial and full asset retirement',
      'Physical inventory reconciliation',
      'Impairment testing and write-down support',
      'Lease classification (ASC 842 / IFRS 16)',
    ],
  },
  {
    id: 'CM',
    name: 'Cash Management',
    suite: 'Financials',
    description:
      'Provides bank account reconciliation, cash position visibility, and cash flow forecasting.',
    capabilities: [
      'Bank statement import (BAI2, SWIFT MT940, CSV)',
      'Automated bank reconciliation',
      'Manual statement line matching',
      'Cash position by bank account and currency',
      'Cash flow forecasting from AR, AP, and payroll',
      'Intercompany netting and settlement',
      'Bank account validation (IBAN, SWIFT)',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Supply Chain Modules
// ─────────────────────────────────────────────────────────────────────────────

export const SCM_MODULES: ERPModuleInfo[] = [
  {
    id: 'INV',
    name: 'Inventory Management',
    suite: 'SCM',
    description:
      'Manages on-hand balances, material movements, lot/serial tracking, and physical inventory ' +
      'across warehouses, subinventories, and locators.',
    capabilities: [
      'On-hand quantity by subinventory and locator',
      'Lot-controlled and serial-controlled item tracking',
      'Material transactions: receipts, issues, transfers, returns',
      'Reservations and demand allocation',
      'Cycle counting programs with ABC classification',
      'Physical inventory counting and reconciliation',
      'Consignment and VMI (Vendor Managed Inventory)',
      'Kanban replenishment signal generation',
      'Inventory valuation: standard, average, FIFO, LIFO',
      'Landed costs allocation',
      'Item master management with UOM conversion',
      'Item categories and category sets',
    ],
    aprisoIntegration:
      'Apriso sends material consumption (WIP component issues), work order completions, ' +
      'and inventory transfers back to Oracle Inventory in real time.',
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/inventoryOnhandQuantities',
      '/fscmRestApi/resources/11.13.18.05/inventoryTransactions',
      '/fscmRestApi/resources/11.13.18.05/items',
    ],
  },
  {
    id: 'PO',
    name: 'Purchasing',
    suite: 'SCM',
    description:
      'Manages the procure-to-pay cycle: requisitions, purchase orders, supplier collaboration, ' +
      'and receiving.',
    capabilities: [
      'Purchase requisitions (manual and auto-sourced from MRP)',
      'Requisition approval workflow',
      'Standard and blanket purchase orders',
      'Contract purchase agreements',
      'Request for quotation (RFQ) and supplier bidding',
      'Supplier acknowledgement and ASN (Advance Ship Notice)',
      'Receiving (standard, inspection, unordered)',
      'Returns to supplier (RTV)',
      'Evaluated receipt settlement (ERS / self-billing)',
      'Procurement catalog and punchout (cXML)',
      'Spend analytics and PO compliance reporting',
      'Supplier performance scorecarding',
    ],
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/purchaseOrders',
      '/fscmRestApi/resources/11.13.18.05/requisitions',
      '/fscmRestApi/resources/11.13.18.05/receipts',
    ],
  },
  {
    id: 'OM',
    name: 'Order Management',
    suite: 'SCM',
    description:
      'Handles the order-to-cash cycle from order entry through shipping and invoicing.',
    capabilities: [
      'Sales order entry (manual, EDI, web services)',
      'Order types and configurable order flows',
      'Global order promising (ATP / CTP)',
      'Price lists and pricing rules',
      'Discount and promotion management',
      'Order holds and release management',
      'Pick, pack, and ship workflow',
      'Carrier and freight management',
      'Drop-ship and back-to-back orders',
      'Return Material Authorization (RMA)',
      'Revenue recognition trigger and auto-invoicing to AR',
    ],
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/orders',
      '/fscmRestApi/resources/11.13.18.05/shipments',
    ],
  },
  {
    id: 'MFG',
    name: 'Discrete Manufacturing',
    suite: 'SCM',
    description:
      'Manages work orders, routings, BOM explosions, and shop-floor costing. Integrates with ' +
      'Apriso MES for real-time shop-floor execution data.',
    capabilities: [
      'Work order (discrete job) creation and release',
      'Bill of Materials (BOM) with revision control',
      'Routing and operation sequence management',
      'Work center and resource definition',
      'Standard and actual cost rollup',
      'WIP material issues and component substitution',
      'Labor and machine time reporting',
      'Move transactions between operations',
      'Scrap and rejection recording',
      'Work order completion and costing',
      'Outside processing (subcontracting) support',
      'Engineering Change Notice (ECN) management',
    ],
    aprisoIntegration:
      'Oracle releases work orders (discrete jobs) to Apriso. Apriso returns labor actuals, ' +
      'material consumption, move transactions, completions, and scrap to Oracle Manufacturing.',
    apiPaths: [
      '/fscmRestApi/resources/11.13.18.05/productionOrders',
      '/fscmRestApi/resources/11.13.18.05/workOrders',
      '/fscmRestApi/resources/11.13.18.05/billsOfMaterials',
    ],
  },
  {
    id: 'PLAN',
    name: 'Advanced Planning',
    suite: 'SCM',
    description:
      'Demand forecasting, MRP/MPS explosion, DRP, and supply chain network optimization.',
    capabilities: [
      'Demand forecasting with statistical models',
      'Consensus demand planning',
      'Master Production Schedule (MPS)',
      'Material Requirements Planning (MRP) net-change explosion',
      'Distribution Requirements Planning (DRP)',
      'Constraint-based capacity-aware planning',
      'Safety stock and reorder point calculation',
      'Planning recommendations: make, buy, transfer, reschedule',
      'Supply chain network optimization',
      'S&OP (Sales & Operations Planning) process support',
      'Simulation scenarios and what-if analysis',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HCM Modules
// ─────────────────────────────────────────────────────────────────────────────

export const HCM_MODULES: ERPModuleInfo[] = [
  {
    id: 'HR',
    name: 'Core HR',
    suite: 'HCM',
    description: 'Employee records, position hierarchy, organization structure, and HR actions.',
    capabilities: [
      'Employee master record (personal info, employment details)',
      'Position management and hierarchy',
      'Organization structure and department management',
      'HR actions and approvals (hire, transfer, promotion, termination)',
      'Worker relationships (employees, contingent workers)',
      'Document management (visas, certifications)',
      'Employee self-service and manager self-service',
      'Global HR compliance (multiple countries)',
    ],
  },
  {
    id: 'PAY',
    name: 'Payroll',
    suite: 'HCM',
    description: 'Gross-to-net payroll calculation, tax withholding, and direct deposit.',
    capabilities: [
      'Payroll element configuration (salary, bonus, deductions)',
      'Gross-to-net payroll calculation',
      'Federal, state, and local tax withholding rules',
      'Benefits deduction processing',
      'Garnishment and involuntary deduction handling',
      'Direct deposit and check printing',
      'Payroll costing to GL accounts',
      'Year-end tax form generation (W-2, 1099)',
      'Payroll audit and reconciliation reports',
    ],
  },
  {
    id: 'TL',
    name: 'Time & Labor',
    suite: 'HCM',
    description: 'Timecard entry, work schedule management, and overtime rule enforcement.',
    capabilities: [
      'Employee timecard entry (web, mobile, kiosk)',
      'Work schedule and shift management',
      'Overtime and premium pay rule calculation',
      'Absence and PTO tracking',
      'FMLA and leave accrual management',
      'Manager timecard approval workflow',
      'Time data transfer to payroll',
      'Labor cost distribution to projects and cost centers',
    ],
  },
  {
    id: 'TALENT',
    name: 'Talent Management',
    suite: 'HCM',
    description: 'Performance management, learning, recruiting, and workforce planning.',
    capabilities: [
      'Performance review cycle management',
      'Goal setting and alignment to company objectives',
      'Competency and skill profile management',
      'Learning management: course catalog, completions, certifications',
      'Job requisition and candidate tracking (ATS)',
      'Onboarding workflow for new hires',
      'Succession planning and talent pools',
      'Workforce planning and headcount budgets',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Reporting Tools
// ─────────────────────────────────────────────────────────────────────────────

export const REPORTING_MODULES: ERPModuleInfo[] = [
  {
    id: 'OTBI',
    name: 'Oracle Transactional Business Intelligence (OTBI)',
    suite: 'Reporting',
    description:
      'Live, ad-hoc reporting tool built into Oracle Cloud ERP. Uses drag-and-drop subject ' +
      'areas that connect directly to transactional data with no extract required.',
    capabilities: [
      'Pre-built subject areas for all Oracle Cloud modules',
      'Drag-and-drop report builder',
      'Real-time transactional data (no ETL delay)',
      'Filters, prompts, and parameters',
      'Dashboard embedding',
      'Excel export and scheduled delivery',
      'Analytic view lens (pivot, chart, table)',
      'Cross-subject area joins',
    ],
  },
  {
    id: 'BIP',
    name: 'BI Publisher',
    suite: 'Reporting',
    description:
      'Pixel-perfect formatted report generation (PDF, Excel, Word). Supports data models, ' +
      'bursting to email, and high-volume batch output.',
    capabilities: [
      'Data model design (SQL, web service, file sources)',
      'Layout templates (RTF, XSL-FO, PDF)',
      'Pixel-perfect output: PDF, Excel, DOCX, HTML, CSV',
      'Bursting: split and route report output by data value',
      'Scheduled report delivery (email, FTP, WebCenter)',
      'Report parameters and user input',
      'Multilingual template support',
      'Integration with Oracle Workflow for report triggers',
    ],
  },
  {
    id: 'FRS',
    name: 'Financial Reporting Studio (FRS)',
    suite: 'Reporting',
    description:
      'GL-based financial statement reporting with comparative periods, hierarchies, and ' +
      'management pack capabilities.',
    capabilities: [
      'Income statements, balance sheets, cash flow statements',
      'Comparative period columns (actual vs. budget vs. prior year)',
      'Account hierarchy and rollup reporting',
      'Expansion rows for GL account detail',
      'Management packs with multiple report tabs',
      'Conditional formatting and suppression rules',
      'Point-of-view controls (ledger, period, scenario)',
      'Excel Smart View integration for ad-hoc drill-down',
    ],
  },
  {
    id: 'OAC',
    name: 'Oracle Analytics Cloud (OAC)',
    suite: 'Reporting',
    description:
      'Advanced analytics platform with AI/ML-driven insights, self-service dashboards, and ' +
      'data blending from multiple sources.',
    capabilities: [
      'Self-service visual analytics and dashboards',
      'AI-powered auto-insights and explain feature',
      'Machine learning model building and deployment',
      'Data blending from multiple sources (Oracle, flat files, REST)',
      'Natural language query (ask questions in plain English)',
      'Predictive analytics and forecasting',
      'Mobile analytics app',
      'Prebuilt analytics content packs for Oracle ERP',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Combined Module Catalog
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_ERP_MODULES: ERPModuleInfo[] = [
  ...FINANCIALS_MODULES,
  ...SCM_MODULES,
  ...HCM_MODULES,
  ...REPORTING_MODULES,
];

export const ERP_MODULE_INDEX: Map<ERPModule, ERPModuleInfo> = new Map(
  ALL_ERP_MODULES.map(m => [m.id, m])
);

export function getERPModule(id: ERPModule): ERPModuleInfo | undefined {
  return ERP_MODULE_INDEX.get(id);
}

export function getModulesBySuite(suite: ERPModuleInfo['suite']): ERPModuleInfo[] {
  return ALL_ERP_MODULES.filter(m => m.suite === suite);
}

export function getModulesWithAprisoIntegration(): ERPModuleInfo[] {
  return ALL_ERP_MODULES.filter(m => m.aprisoIntegration);
}
