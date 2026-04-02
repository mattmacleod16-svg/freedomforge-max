/* ═══════════════════════════════════════════════════════════════════════════
   Trane Enterprise Assistant — Knowledge Base
   ═══════════════════════════════════════════════════════════════════════════

   Full-turnkey, public-domain knowledge base covering:
     • DELMIA Apriso MOM/MES  (§1)
     • Oracle Database SQL + PL/SQL  (§2)
     • Oracle ERP (E-Business Suite / Cloud)  (§3)
     • Apriso ↔ Oracle Integration Patterns  (§4)

   Layout designed for:
     1. RAG / vector-store ingestion (topic chunks)
     2. Structured Q&A dataset
     3. Claude system-prompt injection
     4. UI knowledge-card rendering

   Sources: public Dassault Systèmes, Oracle, and ASHRAE documentation only.
   No proprietary Trane configuration details are included.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type KnowledgeCategory =
  | 'Apriso'
  | 'Oracle_Database'
  | 'Oracle_ERP'
  | 'Integration'
  | 'Manufacturing'
  | 'Quality'
  | 'Compliance';

export interface KnowledgeChunk {
  /** Unique slug used as vector store ID */
  topic: string;
  category: KnowledgeCategory;
  /** Display title for UI */
  title: string;
  /** Full prose content — used as the embedding source */
  content: string;
  /** Optional bullet-point detail list */
  bullets?: string[];
  /** Related topic slugs for graph traversal */
  related?: string[];
}

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  category: KnowledgeCategory;
  /** Source chunk topic slugs that ground this answer */
  sourceTopics: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  APRISO KNOWLEDGE CHUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const APRISO_CHUNKS: KnowledgeChunk[] = [
  {
    topic: 'Apriso_Overview',
    category: 'Apriso',
    title: 'DELMIA Apriso — Overview',
    content:
      'DELMIA Apriso is a Manufacturing Operations Management (MOM) platform used globally for ' +
      'production execution, quality control, logistics, traceability, and real-time performance ' +
      'management. It bridges ERP planning systems with shop-floor reality, providing a single ' +
      'system-of-record for all manufacturing operations across multiple sites.',
    bullets: [
      'Manufacturing Execution System (MES)',
      'Quality Management',
      'Warehouse & Logistics Execution',
      'Maintenance Execution',
      'Production genealogy & traceability',
      'Real-time OEE and KPI visibility',
      'Configurable workflows and operator UIs',
      'Integration with Oracle, SAP, and other ERP/MRP systems',
    ],
    related: ['Apriso_MES', 'Apriso_Quality', 'Apriso_Logistics', 'Apriso_Analytics'],
  },

  {
    topic: 'Apriso_MES',
    category: 'Apriso',
    title: 'Apriso MES — Manufacturing Execution',
    content:
      'Apriso MES orchestrates production from work order release through completion, tracking ' +
      'every operation, resource, and material transaction in real time. It enforces routing ' +
      'sequences, captures machine data, and provides digital work instructions to operators.',
    bullets: [
      'Work order execution and step sequencing',
      'Routing enforcement and line balancing',
      'WIP (Work-in-Process) start/stop/move transactions',
      'Serialized and non-serialized WIP tracking',
      'Parallel operation support',
      'Hold/release logic and exception handling',
      'Digital work instructions with media attachments',
      'Electronic signatures for regulatory compliance',
      'Scrap and rework workflow generation',
      'Real-time downtime capture and categorization',
      'Machine data collection and PLC integration',
      'Operator task guidance and productivity tracking',
      'Nonconformance flagging and disposition',
      'Cycle-time and throughput measurement',
    ],
    related: ['Apriso_Overview', 'Apriso_Quality', 'Apriso_Traceability', 'Apriso_Maintenance'],
  },

  {
    topic: 'Apriso_Quality',
    category: 'Apriso',
    title: 'Apriso Quality Management',
    content:
      'Apriso Quality Management integrates inspection and control across the full product ' +
      'lifecycle — from incoming supplier material through in-process checks to final outgoing ' +
      'inspection. It supports SPC, sampling plans, nonconformance management, and rework routing.',
    bullets: [
      // Incoming
      'Incoming inspection linked to supplier receipts',
      'Sampling plan enforcement (AQL, MIL-STD-1916)',
      'Material quarantine workflows',
      // In-process
      'Quality checkpoints embedded within operations',
      'Automated measurement capture from CMMs and gauges',
      'Statistical Process Control (SPC) with control charts (X-bar, R, p, c)',
      'Out-of-control action plans (OCAP)',
      'Gauge and tool verification',
      // Outgoing
      'Finished goods sampling before shipment',
      'Packout and conformity validation',
      'Certificate of Conformance (CoC) generation',
      // NCR
      'Defect catalog with configurable codes',
      'Nonconformance report (NCR) creation and tracking',
      'Rework routing auto-generation from NCR',
      'Scrap rationale capture and cost tracking',
      'CAPA (Corrective and Preventive Action) linkage',
    ],
    related: ['Apriso_MES', 'Apriso_Traceability', 'Apriso_Analytics'],
  },

  {
    topic: 'Apriso_Logistics',
    category: 'Apriso',
    title: 'Apriso Warehouse & Logistics Execution',
    content:
      'Apriso provides Warehouse Execution System (WES) functionality for manufacturing ' +
      'environments — managing material flow from receiving dock to production line and outbound ' +
      'shipping. It supports kanban, supermarket replenishment, and kitting workflows.',
    bullets: [
      'Inbound receiving and goods receipt',
      'Directed put-away with location rules',
      'Internal move transactions',
      'Directed picking by work order or delivery',
      'Kitting workflows for assembly work orders',
      'Line-side replenishment triggers',
      'Supermarket and kanban loop management',
      'Pack and ship execution',
      'Container and pallet management',
      'Full lot/serial traceability through warehouse moves',
      'Label printing integration',
      'Carrier and freight document generation',
    ],
    related: ['Apriso_Overview', 'Apriso_Traceability', 'Integration_Apriso_Oracle'],
  },

  {
    topic: 'Apriso_Maintenance',
    category: 'Apriso',
    title: 'Apriso Maintenance Execution',
    content:
      'Apriso Maintenance manages equipment health and preventive maintenance (PM) programs ' +
      'directly on the shop floor, integrating with equipment status and downtime data from the MES.',
    bullets: [
      'Preventive maintenance order creation and scheduling',
      'Maintenance work order execution workflow',
      'Equipment state management (running, down, PM, idle)',
      'Real-time downtime capture and classification',
      'Machine health monitoring integrations',
      'Spare parts consumption recording',
      'Maintenance history log per equipment',
      'Integration with CMMS systems (IBM Maximo, ServiceNow)',
    ],
    related: ['Apriso_MES', 'Apriso_Analytics'],
  },

  {
    topic: 'Apriso_Traceability',
    category: 'Apriso',
    title: 'Apriso Traceability & Genealogy',
    content:
      'Apriso maintains a complete, immutable production genealogy for every unit produced — ' +
      'linking raw materials, components, process parameters, equipment, operators, and quality ' +
      'results into a single product DNA record. Supports forward and backward trace queries.',
    bullets: [
      'Full genealogy: material + process + quality linked per serialized unit',
      'Forward trace: from raw material lot to finished product',
      'Backward trace: from finished product to all input materials',
      'Multi-level BOM material genealogy',
      'Operation history with timestamps, operators, and machines',
      'Lot/serial number tracking throughout all transactions',
      'Quality result linkage to production records',
      'Product DNA export for customer traceability requirements',
      'Regulatory compliance support (FDA 21 CFR Part 11, automotive, aerospace)',
    ],
    related: ['Apriso_MES', 'Apriso_Quality', 'Apriso_Logistics'],
  },

  {
    topic: 'Apriso_Analytics',
    category: 'Apriso',
    title: 'Apriso Analytics & Performance',
    content:
      'Apriso provides real-time manufacturing intelligence through OEE dashboards, downtime ' +
      'Pareto charts, quality KPI trending, and configurable event-triggered alerts. Data feeds ' +
      'BI tools via standard APIs.',
    bullets: [
      'OEE calculation: Availability × Performance × Quality',
      'Downtime Pareto by equipment, shift, and reason code',
      'Throughput visualization and trend analysis',
      'Cycle-time analysis vs. standard times',
      'Quality KPI trending (reject rates, first-pass yield)',
      'WIP dashboard by work center and order',
      'Real-time operator productivity metrics',
      'Event-driven KPI alerts and notifications',
      'Data export to Oracle BI, Tableau, and Power BI',
    ],
    related: ['Apriso_MES', 'Apriso_Quality', 'Apriso_Maintenance'],
  },

  {
    topic: 'Apriso_Configuration',
    category: 'Apriso',
    title: 'Apriso Configuration — Process Builder & Screen Builder',
    content:
      'Apriso is highly configurable without custom code, using Process Builder for workflow ' +
      'logic and Screen Builder for operator UIs. Business rules, custom fields, and event ' +
      'triggers are managed through a layered configuration framework.',
    bullets: [
      // Process Builder
      'Process Builder: graphical workflow design tool',
      'Event-driven trigger configuration',
      'Operation rules and state transition logic',
      'Exception handling rules per process step',
      'Multi-site process library with inheritance',
      // Screen Builder
      'Screen Builder: drag-and-drop UI layout tool',
      'Data entry widgets with validation rules',
      'Barcode scanner and RFID integration widgets',
      'Operator workflow screens per role',
      // Business Rules
      'Master data extension with custom fields',
      'Calculated fields and derived values',
      'SOP and compliance rule enforcement',
      // Integration
      'Message-based ERP integration framework',
      'PLC and machine connector configuration',
      'REST and SOAP web service integration',
      'Master data synchronization rules',
    ],
    related: ['Apriso_Overview', 'Integration_Apriso_Oracle'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §2  ORACLE DATABASE KNOWLEDGE CHUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const ORACLE_DB_CHUNKS: KnowledgeChunk[] = [
  {
    topic: 'Oracle_SQL_String',
    category: 'Oracle_Database',
    title: 'Oracle SQL — String Functions',
    content:
      'Oracle SQL provides a comprehensive set of string manipulation functions used in ' +
      'queries, reports, and PL/SQL programs for text formatting, parsing, and transformation.',
    bullets: [
      'SUBSTR(str, pos, len)  — extract substring',
      'INSTR(str, substr)     — find position of substring',
      'LENGTH(str)            — character count',
      "LOWER(str) / UPPER(str) — case conversion",
      'REPLACE(str, old, new) — string substitution',
      'REGEXP_REPLACE(str, pattern, replace) — regex substitution',
      'TRIM / LTRIM / RTRIM   — whitespace or character removal',
      'LPAD / RPAD            — padding to fixed width',
      'CONCAT / || operator   — string concatenation',
      'INITCAP                — capitalize first letter of each word',
    ],
    related: ['Oracle_SQL_Date', 'Oracle_SQL_Numeric', 'Oracle_SQL_Conversion'],
  },

  {
    topic: 'Oracle_SQL_Date',
    category: 'Oracle_Database',
    title: 'Oracle SQL — Date & Time Functions',
    content:
      'Oracle date functions handle arithmetic, formatting, and extraction of date components. ' +
      'SYSDATE returns the current database server timestamp.',
    bullets: [
      'SYSDATE               — current date and time (server)',
      'CURRENT_DATE          — current date in session timezone',
      'ADD_MONTHS(date, n)   — add/subtract months',
      'LAST_DAY(date)        — last day of the month',
      'NEXT_DAY(date, day)   — next occurrence of a weekday',
      'MONTHS_BETWEEN(d1,d2) — fractional months between two dates',
      'EXTRACT(part FROM date) — extract year/month/day/hour/minute/second',
      'TRUNC(date, format)   — truncate to day, month, year',
      'TO_CHAR(date, format) — format date as string',
      'TO_DATE(str, format)  — parse string to date',
      'INTERVAL literals     — date arithmetic (e.g., SYSDATE + INTERVAL 1 DAY)',
    ],
    related: ['Oracle_SQL_String', 'Oracle_SQL_Conversion', 'Oracle_PLSQL_Packages'],
  },

  {
    topic: 'Oracle_SQL_Numeric',
    category: 'Oracle_Database',
    title: 'Oracle SQL — Numeric Functions',
    content:
      'Oracle numeric functions support mathematical operations, rounding, and statistical ' +
      'calculations in SQL queries and PL/SQL programs.',
    bullets: [
      'ROUND(n, decimals)    — round to decimal places',
      'TRUNC(n, decimals)    — truncate (no rounding)',
      'FLOOR(n)              — largest integer ≤ n',
      'CEIL(n)               — smallest integer ≥ n',
      'ABS(n)                — absolute value',
      'POWER(base, exp)      — exponentiation',
      'SQRT(n)               — square root',
      'MOD(m, n)             — modulo remainder',
      'SIGN(n)               — -1, 0, or 1',
      'LOG(base, n)          — logarithm',
    ],
    related: ['Oracle_SQL_Aggregates', 'Oracle_SQL_Window'],
  },

  {
    topic: 'Oracle_SQL_Conversion',
    category: 'Oracle_Database',
    title: 'Oracle SQL — Conversion & Null-Handling Functions',
    content:
      'Conversion functions transform data types between numbers, dates, and strings. ' +
      'Null-handling functions protect queries from NULL propagation.',
    bullets: [
      'CAST(val AS type)       — explicit type conversion',
      'TO_CHAR(n/date, fmt)    — number or date to string',
      'TO_DATE(str, fmt)       — string to date',
      'TO_NUMBER(str, fmt)     — string to number',
      'NVL(expr, default)      — replace NULL with default',
      'NVL2(expr, not_null, null_val) — conditional on NULL',
      'NULLIF(a, b)            — return NULL if a = b',
      'COALESCE(a,b,c,...)     — first non-NULL value',
      'CASE ... WHEN ... END   — conditional logic',
      'DECODE(expr, srch, res) — legacy conditional shorthand',
    ],
    related: ['Oracle_SQL_String', 'Oracle_SQL_Date'],
  },

  {
    topic: 'Oracle_SQL_Aggregates',
    category: 'Oracle_Database',
    title: 'Oracle SQL — Aggregate Functions',
    content:
      'Aggregate functions collapse multiple rows into a summary value. Used with GROUP BY ' +
      'for reporting and analytics.',
    bullets: [
      'SUM(col)      — total of values',
      'COUNT(col/*)  — row count',
      'AVG(col)      — arithmetic mean',
      'MIN(col)      — minimum value',
      'MAX(col)      — maximum value',
      'STDDEV(col)   — standard deviation',
      'VARIANCE(col) — variance',
      "LISTAGG(col, delim) WITHIN GROUP (ORDER BY ...) — concatenate values into a string",
      'MEDIAN(col)   — middle value',
      'GROUP BY ROLLUP/CUBE — multi-level subtotals',
      'HAVING clause — filter on aggregate result',
    ],
    related: ['Oracle_SQL_Window', 'Oracle_SQL_Numeric'],
  },

  {
    topic: 'Oracle_SQL_Window',
    category: 'Oracle_Database',
    title: 'Oracle SQL — Window / Analytic Functions',
    content:
      'Window functions compute values over a sliding window of rows relative to the current ' +
      'row, without collapsing the result set. Essential for ranking, running totals, and ' +
      'period-over-period comparisons in manufacturing and financial reports.',
    bullets: [
      'OVER (PARTITION BY col ORDER BY col) — defines the window',
      'ROW_NUMBER()    — sequential integer per partition',
      'RANK()          — rank with gaps for ties',
      'DENSE_RANK()    — rank without gaps',
      'LAG(col, n)     — value from n rows before current',
      'LEAD(col, n)    — value from n rows after current',
      'FIRST_VALUE(col) — first value in the window',
      'LAST_VALUE(col)  — last value in the window',
      'SUM(col) OVER () — running total',
      'AVG(col) OVER (ROWS BETWEEN n PRECEDING AND CURRENT ROW) — moving average',
      'NTILE(n)        — divide rows into n equal buckets',
    ],
    related: ['Oracle_SQL_Aggregates', 'Oracle_DataDictionary'],
  },

  {
    topic: 'Oracle_PLSQL_Packages',
    category: 'Oracle_Database',
    title: 'Oracle PL/SQL — Built-in Packages',
    content:
      'Oracle ships a rich set of built-in PL/SQL packages for I/O, scheduling, cryptography, ' +
      'metadata management, and database utilities. These are the primary extension points for ' +
      'server-side business logic in Oracle-based systems like Oracle ERP.',
    bullets: [
      'DBMS_OUTPUT      — write debug/log messages to console',
      'DBMS_SQL         — dynamic SQL execution at runtime',
      'DBMS_SCHEDULER   — job scheduling (replaces DBMS_JOB)',
      'DBMS_JOB         — legacy job scheduler',
      'DBMS_LOB         — read/write large objects (CLOB, BLOB)',
      'DBMS_METADATA    — extract DDL for database objects',
      'DBMS_STATS       — gather optimizer statistics',
      'DBMS_CRYPTO      — encryption and hashing (AES, SHA, 3DES)',
      'DBMS_UTILITY     — miscellaneous utility procedures',
      'UTL_FILE         — read/write OS files from PL/SQL',
      'UTL_HTTP         — HTTP GET/POST from PL/SQL',
      'UTL_SMTP         — send email from PL/SQL',
      'UTL_RAW          — raw byte manipulation',
    ],
    related: ['Oracle_SQL_Date', 'Oracle_DataDictionary'],
  },

  {
    topic: 'Oracle_DataDictionary',
    category: 'Oracle_Database',
    title: 'Oracle Data Dictionary & System Views',
    content:
      'The Oracle data dictionary provides metadata about every object in the database. Views ' +
      'are organized by access level: USER_ (own objects), ALL_ (accessible objects), DBA_ ' +
      '(all objects), and V$ (dynamic performance views).',
    bullets: [
      // USER views
      'USER_TABLES         — tables owned by current user',
      'USER_TAB_COLUMNS    — column definitions for owned tables',
      'USER_OBJECTS        — all owned objects (tables, views, procedures, etc.)',
      'USER_SOURCE         — PL/SQL source code for owned objects',
      // ALL views
      'ALL_TABLES          — tables accessible to current user',
      'ALL_TAB_PRIVS       — privileges on accessible objects',
      // DBA views (requires DBA role)
      'DBA_TABLES          — all tables in the database',
      'DBA_USERS           — all database users',
      'DBA_SOURCE          — all PL/SQL source code',
      'DBA_SEGMENTS        — storage segment information',
      // V$ performance views
      'V$SESSION           — active sessions',
      'V$SQL               — SQL statements in shared pool',
      'V$LOCK              — current lock holders',
      'V$SYSTEM_EVENT      — system-wide wait events',
    ],
    related: ['Oracle_PLSQL_Packages', 'Oracle_SQL_Window'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §3  ORACLE ERP KNOWLEDGE CHUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const ORACLE_ERP_CHUNKS: KnowledgeChunk[] = [
  {
    topic: 'Oracle_ERP_Overview',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Overview',
    content:
      'Oracle ERP (available as E-Business Suite on-premise and Oracle Cloud ERP / Fusion ' +
      'Applications SaaS) covers the full enterprise: financials, supply chain, manufacturing, ' +
      'HR, and analytics. It provides real-time financial control and supply chain execution ' +
      'for organizations of all sizes.',
    bullets: [
      'Financials: GL, AP, AR, Fixed Assets, Cash Management',
      'Supply Chain: Inventory, Purchasing, Order Management, Manufacturing, Planning',
      'Human Capital Management: Core HR, Payroll, Time & Labor, Talent',
      'Reporting: OTBI, BI Publisher, Financial Reporting Studio',
      'Integration Hub: REST APIs, SOAP services, file-based integrations',
    ],
    related: ['Oracle_ERP_Financials', 'Oracle_ERP_SCM', 'Oracle_ERP_HCM', 'Oracle_ERP_Reporting'],
  },

  {
    topic: 'Oracle_ERP_GL',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — General Ledger (GL)',
    content:
      'The General Ledger is the financial system of record. It holds the chart of accounts, ' +
      'all journal entries, and period-close processes. All sub-ledgers (AP, AR, FA) post ' +
      'transactions to the GL.',
    bullets: [
      'Chart of Accounts (COA) with segment structure',
      'Manual and automated journal entry',
      'Recurring journal templates',
      'Statistical journals for non-financial data',
      'Budget entry and variance reporting',
      'Allocation rules (formula-based, statistical)',
      'Intercompany and intracompany balancing',
      'Multi-currency revaluation and translation',
      'Consolidation across ledgers and legal entities',
      'Period-end close process with approval workflow',
      'Account reconciliation and certification',
      'GAAP and IFRS dual-ledger support',
    ],
    related: ['Oracle_ERP_Overview', 'Oracle_ERP_AP', 'Oracle_ERP_AR', 'Oracle_ERP_Reporting'],
  },

  {
    topic: 'Oracle_ERP_AP',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Accounts Payable (AP)',
    content:
      'Accounts Payable manages the full supplier invoice lifecycle from receipt through payment, ' +
      'including automated matching against purchase orders and receipts.',
    bullets: [
      'Invoice entry (manual and automated/OCR import)',
      '2-way PO matching (invoice vs. PO)',
      '3-way matching (invoice vs. PO vs. receipt)',
      '4-way matching (includes inspection result)',
      'Invoice approval workflow (amount thresholds, hierarchy)',
      'Prepayment and advance payment processing',
      'Payment proposals and check/ACH/wire runs',
      'Early payment discount management',
      'Supplier master management and banking details',
      'Foreign currency invoice processing',
      'Expense report processing (employee reimbursements)',
      'Hold and release logic for problem invoices',
      'Accrual processing for uninvoiced receipts',
    ],
    related: ['Oracle_ERP_GL', 'Oracle_ERP_SCM_Purchasing'],
  },

  {
    topic: 'Oracle_ERP_AR',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Accounts Receivable (AR)',
    content:
      'Accounts Receivable manages customer billing, collections, and cash application. It ' +
      'integrates with Order Management for auto-invoicing and with Cash Management for bank ' +
      'reconciliation.',
    bullets: [
      'Customer invoice generation (manual and auto-invoice)',
      'Credit memo and debit memo processing',
      'Customer receipt entry (lockbox, manual, EFT)',
      'Auto-cash application rules',
      'Unapplied and on-account receipt management',
      'Collections workbench (aging, dunning letters)',
      'Customer account statements',
      'Revenue recognition scheduling',
      'Tax calculation and reporting',
      'Customer credit limit management',
      'Factoring and receivables financing support',
      'Multi-currency receivables and revaluation',
    ],
    related: ['Oracle_ERP_GL', 'Oracle_ERP_SCM_OM'],
  },

  {
    topic: 'Oracle_ERP_FA',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Fixed Assets (FA)',
    content:
      'Fixed Assets manages the lifecycle of capital assets from acquisition through retirement, ' +
      'automating depreciation and supporting multiple book types for GAAP, tax, and internal reporting.',
    bullets: [
      'Asset creation from PO receipts or manual entry',
      'CIP (Construction in Progress) asset tracking',
      'Multiple depreciation methods (straight-line, MACRS, units of production)',
      'Multiple depreciation books (corporate, tax, AMT)',
      'Mass additions from payables',
      'Asset transfers between cost centers and locations',
      'Asset reclassification',
      'Partial and full retirement processing',
      'Physical inventory reconciliation',
      'Impairment testing support',
      'Tax reporting forms support',
    ],
    related: ['Oracle_ERP_GL', 'Oracle_ERP_Overview'],
  },

  {
    topic: 'Oracle_ERP_SCM_Inventory',
    category: 'Oracle_ERP',
    title: 'Oracle ERP SCM — Inventory Management',
    content:
      'Oracle Inventory manages on-hand balances, material movements, lot and serial number ' +
      'tracking, and physical inventory processes across warehouses and sub-inventories.',
    bullets: [
      'On-hand quantity by subinventory and locator',
      'Lot-controlled and serial-controlled items',
      'Material transactions: receipts, issues, transfers, returns',
      'Reservations and demand allocation',
      'Cycle counting programs with ABC classification',
      'Physical inventory counting and reconciliation',
      'Consignment and VMI (Vendor Managed Inventory)',
      'Kanban replenishment signals',
      'Inventory valuation: standard, average, FIFO, LIFO',
      'Landed costs allocation',
      'Item master management with UOM conversion',
    ],
    related: ['Oracle_ERP_SCM_Purchasing', 'Oracle_ERP_SCM_Manufacturing', 'Integration_Apriso_Oracle'],
  },

  {
    topic: 'Oracle_ERP_SCM_Purchasing',
    category: 'Oracle_ERP',
    title: 'Oracle ERP SCM — Purchasing',
    content:
      'Oracle Purchasing manages the procure-to-pay cycle: requisitions, purchase orders, ' +
      'supplier collaboration, and receiving.',
    bullets: [
      'Purchase requisitions (manual and auto-sourced from MRP)',
      'Requisition approval workflow',
      'Standard and blanket purchase orders',
      'Contract purchase agreements',
      'Request for quotation (RFQ) and supplier bidding',
      'Supplier acknowledgement and ASN (Advance Ship Notice)',
      'Receiving (standard, inspection, unordered)',
      'Returns to supplier (RTV)',
      'Evaluated receipt settlement (ERS / self-billing)',
      'Procurement catalog and punchout integration',
      'Spend analytics and PO compliance reporting',
      'Supplier performance scorecarding',
    ],
    related: ['Oracle_ERP_AP', 'Oracle_ERP_SCM_Inventory'],
  },

  {
    topic: 'Oracle_ERP_SCM_OM',
    category: 'Oracle_ERP',
    title: 'Oracle ERP SCM — Order Management (OM)',
    content:
      'Oracle Order Management handles the order-to-cash cycle from order entry through ' +
      'shipping and invoicing.',
    bullets: [
      'Sales order entry (manual, EDI, web services)',
      'Order types and order flows',
      'Global order promising (ATP / CTP)',
      'Price lists and pricing rules',
      'Discount and promotion management',
      'Order holds and release management',
      'Pick, pack, and ship workflow',
      'Shipping transaction forms',
      'Freight and carrier management',
      'Drop-ship and back-to-back orders',
      'Return Material Authorization (RMA)',
      'Revenue recognition and auto-invoicing to AR',
    ],
    related: ['Oracle_ERP_AR', 'Oracle_ERP_SCM_Inventory'],
  },

  {
    topic: 'Oracle_ERP_SCM_Manufacturing',
    category: 'Oracle_ERP',
    title: 'Oracle ERP SCM — Discrete Manufacturing',
    content:
      'Oracle Discrete Manufacturing manages work orders, routings, BOM explosions, and shop ' +
      'floor costing. It integrates with Apriso MES for real-time execution data.',
    bullets: [
      'Work order (discrete job) creation and release',
      'Bill of Materials (BOM) management with revision control',
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
    related: ['Oracle_ERP_SCM_Inventory', 'Apriso_MES', 'Integration_Apriso_Oracle'],
  },

  {
    topic: 'Oracle_ERP_SCM_Planning',
    category: 'Oracle_ERP',
    title: 'Oracle ERP SCM — Advanced Planning',
    content:
      'Oracle Advanced Planning provides demand forecasting, Material Requirements Planning ' +
      '(MRP), Master Production Scheduling (MPS), and Distribution Requirements Planning (DRP).',
    bullets: [
      'Demand forecasting with statistical models',
      'Consensus demand planning',
      'Master Production Schedule (MPS)',
      'Material Requirements Planning (MRP) explosion',
      'Distribution Requirements Planning (DRP)',
      'Constraint-based planning (capacity-aware)',
      'Safety stock and reorder point calculation',
      'Planning recommendations: make, buy, transfer, reschedule',
      'Supply chain network optimization',
      'S&OP (Sales & Operations Planning) process',
    ],
    related: ['Oracle_ERP_SCM_Manufacturing', 'Oracle_ERP_SCM_Inventory'],
  },

  {
    topic: 'Oracle_ERP_HCM',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Human Capital Management (HCM)',
    content:
      'Oracle HCM covers employee lifecycle management from hire to retire, payroll processing, ' +
      'time tracking, and talent development.',
    bullets: [
      'Core HR: employee records, position hierarchy, org structure',
      'Payroll: gross-to-net calculation, tax rules, direct deposit',
      'Benefits: health, dental, 401k enrollment and administration',
      'Time & Labor: timecard entry, work schedules, overtime rules',
      'Absence Management: PTO, FMLA, leave accruals',
      'Talent Management: performance reviews, goal setting',
      'Learning Management: course catalog, completions, certifications',
      'Recruiting: job requisitions, candidate tracking, onboarding',
      'Workforce Planning: headcount budgets, succession planning',
    ],
    related: ['Oracle_ERP_Overview'],
  },

  {
    topic: 'Oracle_ERP_Reporting',
    category: 'Oracle_ERP',
    title: 'Oracle ERP — Reporting Tools',
    content:
      'Oracle Cloud ERP includes three primary reporting tools for operational, financial, and ' +
      'ad-hoc reporting needs.',
    bullets: [
      'OTBI (Oracle Transactional Business Intelligence): live ad-hoc reporting with drag-and-drop subject areas; real-time data',
      'BI Publisher: pixel-perfect formatted reports (PDF, Excel, XML); supports bursting to email',
      'FRS (Financial Reporting Studio): GL-based financial statements, comparative reports, management packs',
      'Oracle Analytics Cloud (OAC): advanced analytics, dashboards, AI/ML insights',
      'Smart View: Excel add-in for GL and planning data extraction',
      'OTBI subject areas cover: GL, AP, AR, FA, Inventory, Purchasing, OM, HR, Payroll',
    ],
    related: ['Oracle_ERP_GL', 'Oracle_ERP_Overview'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §4  INTEGRATION KNOWLEDGE CHUNKS
// ─────────────────────────────────────────────────────────────────────────────

export const INTEGRATION_CHUNKS: KnowledgeChunk[] = [
  {
    topic: 'Integration_Apriso_Oracle',
    category: 'Integration',
    title: 'Apriso ↔ Oracle ERP Integration',
    content:
      'The Apriso–Oracle integration synchronizes master data, releases production orders to ' +
      'the shop floor, and returns actuals (labor, material, quality) back to Oracle for ' +
      'costing and inventory accuracy. Common integration patterns use REST APIs, SOAP ' +
      'services, message queues, and file-based transfers.',
    bullets: [
      // Master data (ERP → Apriso)
      'Item master sync (ERP → Apriso)',
      'Bill of Materials (BOM) sync (ERP → Apriso)',
      'Routing and operation sync (ERP → Apriso)',
      'Supplier and customer master sync',
      'Work center and resource master sync',
      // Transaction flows
      'Work order release (ERP → Apriso for execution)',
      'Material consumption actuals (Apriso → ERP WIP issue)',
      'Labor and machine time booking (Apriso → ERP)',
      'Scrap and reject recording (Apriso → ERP)',
      'Work order completion (Apriso → ERP move transaction)',
      'Inventory transfer transactions',
      'Quality results (Apriso → ERP for costing/compliance)',
      // Technologies
      'REST API (JSON) — preferred for real-time event-driven integration',
      'SOAP/WSDL — legacy and Oracle E-Business Suite integrations',
      'Oracle Advanced Queuing (AQ) / JMS message queues',
      'Flat-file / SFTP batch transfers (legacy fallback)',
      'Oracle Integration Cloud (OIC) as middleware hub',
    ],
    related: ['Apriso_MES', 'Oracle_ERP_SCM_Manufacturing', 'Oracle_ERP_SCM_Inventory'],
  },

  {
    topic: 'Integration_Technologies',
    category: 'Integration',
    title: 'Enterprise Integration Technologies',
    content:
      'Modern manufacturing integrations use a combination of synchronous APIs, asynchronous ' +
      'messaging, and batch file transfers to connect MES, ERP, CMMS, and IIoT systems.',
    bullets: [
      'REST (HTTP/JSON)     — synchronous, real-time, lightweight',
      'SOAP (XML/WSDL)      — contract-based, used in older Oracle EBS integrations',
      'OData                — REST extension for querying relational data (Oracle Cloud)',
      'GraphQL              — flexible query API for complex data graphs',
      'JMS / Oracle AQ      — asynchronous message queuing, guaranteed delivery',
      'MQTT / Sparkplug B   — IIoT device messaging over lightweight protocol',
      'OPC-UA               — industrial device interoperability standard',
      'Flat file / SFTP     — batch processing, legacy system compatibility',
      'Oracle Integration Cloud (OIC) — Oracle-native iPaaS middleware',
      'MuleSoft             — enterprise API platform widely used with Oracle',
    ],
    related: ['Integration_Apriso_Oracle', 'Oracle_ERP_Overview'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §5  Q&A RAG DATASET
// ─────────────────────────────────────────────────────────────────────────────

export const QA_DATASET: QAPair[] = [
  {
    id: 'qa-001',
    category: 'Apriso',
    question: 'What does Apriso MES do?',
    answer:
      'Apriso MES (Manufacturing Execution System) orchestrates shop-floor production. It ' +
      'releases work orders to operators, enforces routing step sequences, tracks WIP ' +
      'start/stop/move transactions, captures scrap and downtime, guides operators with digital ' +
      'work instructions, collects machine data via PLC integrations, and records electronic ' +
      'signatures for compliance. It also generates rework workflows when nonconformances are detected.',
    sourceTopics: ['Apriso_MES', 'Apriso_Overview'],
  },
  {
    id: 'qa-002',
    category: 'Apriso',
    question: 'How does Apriso support traceability?',
    answer:
      'Apriso maintains a complete production genealogy for every serialized or lot-controlled ' +
      'unit. It links raw material lots, component serial numbers, operation history, operator ' +
      'IDs, machine IDs, process parameters, and quality results into a single "Product DNA" ' +
      'record. Both forward trace (raw material → finished goods) and backward trace ' +
      '(finished goods → all input materials) queries are supported.',
    sourceTopics: ['Apriso_Traceability', 'Apriso_Quality'],
  },
  {
    id: 'qa-003',
    category: 'Apriso',
    question: 'What warehouse functions does Apriso support?',
    answer:
      'Apriso supports full warehouse execution including: inbound receiving and goods receipt, ' +
      'directed put-away, internal move transactions, directed picking by work order or delivery, ' +
      'kitting for assembly orders, line-side replenishment, supermarket and kanban loop ' +
      'management, packing, and outbound shipping. Full lot and serial traceability is ' +
      'maintained through all warehouse transactions.',
    sourceTopics: ['Apriso_Logistics'],
  },
  {
    id: 'qa-004',
    category: 'Apriso',
    question: 'How does Apriso calculate OEE?',
    answer:
      'OEE (Overall Equipment Effectiveness) = Availability × Performance × Quality. ' +
      'Availability = (Planned Time − Downtime) / Planned Time. ' +
      'Performance = (Actual Output × Ideal Cycle Time) / Run Time. ' +
      'Quality = Good Units / Total Units Started. ' +
      'Apriso captures downtime by reason code and shift, machine cycle times, and quality ' +
      'reject counts in real time, feeding the OEE calculation automatically.',
    sourceTopics: ['Apriso_Analytics', 'Apriso_MES'],
  },
  {
    id: 'qa-005',
    category: 'Oracle_Database',
    question: 'What SQL functions help with date calculations in Oracle?',
    answer:
      'Common Oracle date functions: SYSDATE (current timestamp), ADD_MONTHS (add/subtract ' +
      'months), LAST_DAY (last day of month), NEXT_DAY (next weekday occurrence), ' +
      'MONTHS_BETWEEN (fractional months between two dates), EXTRACT (get year/month/day ' +
      'component), TRUNC (truncate to day/month/year), TO_CHAR (format as string), and ' +
      'TO_DATE (parse string to date). Interval literals like SYSDATE + INTERVAL \'1\' DAY ' +
      'also perform date arithmetic.',
    sourceTopics: ['Oracle_SQL_Date'],
  },
  {
    id: 'qa-006',
    category: 'Oracle_Database',
    question: 'What Oracle package is used to schedule jobs?',
    answer:
      'DBMS_SCHEDULER is the primary Oracle package for job scheduling. It replaced the legacy ' +
      'DBMS_JOB package and supports cron-style schedules, event-based triggers, job chains, ' +
      'and job classes with resource limits. DBMS_JOB is still supported for backward compatibility.',
    sourceTopics: ['Oracle_PLSQL_Packages'],
  },
  {
    id: 'qa-007',
    category: 'Oracle_Database',
    question: 'How do window functions differ from aggregate functions in Oracle?',
    answer:
      'Aggregate functions (SUM, COUNT, AVG) collapse groups of rows into a single result row. ' +
      'Window functions (using OVER clause) compute values across a defined row window while ' +
      'preserving every row in the output. For example, SUM(sales) GROUP BY month gives one ' +
      'row per month, while SUM(sales) OVER (ORDER BY month) gives a running total alongside ' +
      'every original row. Window functions also enable LAG/LEAD for period-over-period ' +
      'comparisons and ROW_NUMBER/RANK for ranking without subqueries.',
    sourceTopics: ['Oracle_SQL_Window', 'Oracle_SQL_Aggregates'],
  },
  {
    id: 'qa-008',
    category: 'Oracle_ERP',
    question: 'What does Oracle Inventory manage?',
    answer:
      'Oracle Inventory manages on-hand quantity balances by subinventory and locator, ' +
      'lot-controlled and serial-controlled item tracking, all material transactions (receipts, ' +
      'issues, transfers, returns), reservations and demand allocation, cycle counting programs, ' +
      'physical inventory reconciliation, consignment/VMI, kanban replenishment signals, and ' +
      'inventory valuation (standard, average, FIFO, LIFO cost methods).',
    sourceTopics: ['Oracle_ERP_SCM_Inventory'],
  },
  {
    id: 'qa-009',
    category: 'Oracle_ERP',
    question: 'What reporting tools does Oracle Cloud ERP provide?',
    answer:
      'Oracle Cloud ERP provides: (1) OTBI — live, ad-hoc drag-and-drop reporting using ' +
      'pre-built subject areas covering all modules; (2) BI Publisher — pixel-perfect formatted ' +
      'reports (PDF, Excel) with data model and bursting capability; (3) FRS (Financial ' +
      'Reporting Studio) — GL-based financial statements and management packs with comparative ' +
      'periods; (4) Oracle Analytics Cloud (OAC) — advanced dashboards and AI/ML-driven ' +
      'insights; (5) Smart View — Excel add-in for direct GL and planning data access.',
    sourceTopics: ['Oracle_ERP_Reporting'],
  },
  {
    id: 'qa-010',
    category: 'Integration',
    question: 'What can be integrated between Oracle ERP and Apriso?',
    answer:
      'Common Apriso–Oracle integrations include: master data (item master, BOM, routing, work ' +
      'center) flowing from Oracle ERP to Apriso; and transaction data flowing back from Apriso ' +
      'to Oracle, including work order completion, material consumption (WIP issues), labor and ' +
      'machine time bookings, scrap/reject recording, and quality results. Technologies used ' +
      'include REST APIs, SOAP/WSDL services, Oracle AQ message queues, and flat-file transfers.',
    sourceTopics: ['Integration_Apriso_Oracle'],
  },
  {
    id: 'qa-011',
    category: 'Oracle_ERP',
    question: 'What is 3-way matching in Oracle AP?',
    answer:
      'Three-way matching in Oracle Accounts Payable compares three documents before approving ' +
      'an invoice for payment: (1) the Supplier Invoice, (2) the Purchase Order (PO), and ' +
      '(3) the Receiving transaction (proof goods were received). The system checks that ' +
      'quantities and prices align within configured tolerance thresholds. If mismatches exceed ' +
      'tolerances, the invoice is placed on hold pending resolution. A 2-way match checks only ' +
      'invoice vs. PO; a 4-way match adds an inspection receipt.',
    sourceTopics: ['Oracle_ERP_AP', 'Oracle_ERP_SCM_Purchasing'],
  },
  {
    id: 'qa-012',
    category: 'Apriso',
    question: 'What quality inspection types does Apriso support?',
    answer:
      'Apriso Quality supports three inspection stages: (1) Incoming — supplier receipt ' +
      'inspection with sampling plan enforcement (AQL) and material quarantine workflows; ' +
      '(2) In-process — quality checkpoints embedded within production operations, supporting ' +
      'automated measurement capture from CMMs, SPC control charts, and gauge verification; ' +
      '(3) Outgoing — finished goods sampling, packout inspections, and Certificate of ' +
      'Conformance (CoC) generation. All inspection results are linked to the production ' +
      'genealogy for full traceability.',
    sourceTopics: ['Apriso_Quality', 'Apriso_Traceability'],
  },
  {
    id: 'qa-013',
    category: 'Oracle_ERP',
    question: 'How does Oracle Manufacturing integrate with Apriso MES?',
    answer:
      'Oracle Discrete Manufacturing and Apriso MES integrate bidirectionally. Oracle releases ' +
      'work orders (discrete jobs) to Apriso for shop-floor execution. Apriso sends back ' +
      'actuals: labor hours, machine time, material consumption (WIP component issues), ' +
      'completed assembly quantities, and scrap/reject counts. These actuals update Oracle ' +
      'costing (standard vs. actual cost variance) and inventory on-hand balances. The ' +
      'integration typically uses REST APIs or Oracle Integration Cloud (OIC) as middleware.',
    sourceTopics: ['Integration_Apriso_Oracle', 'Apriso_MES', 'Oracle_ERP_SCM_Manufacturing'],
  },
  {
    id: 'qa-014',
    category: 'Oracle_Database',
    question: 'How do I handle NULL values in Oracle SQL?',
    answer:
      'Oracle SQL provides several NULL-handling functions: NVL(expr, default) substitutes a ' +
      'default when expr is NULL; NVL2(expr, val_if_not_null, val_if_null) chooses between two ' +
      'values based on NULL; NULLIF(a, b) returns NULL if a equals b, otherwise returns a; ' +
      'COALESCE(a, b, c, ...) returns the first non-NULL value from the list. Use IS NULL / ' +
      'IS NOT NULL in WHERE clauses — never = NULL, as NULL comparisons always evaluate to ' +
      'UNKNOWN, not TRUE/FALSE.',
    sourceTopics: ['Oracle_SQL_Conversion'],
  },
  {
    id: 'qa-015',
    category: 'Apriso',
    question: 'What is the Process Builder in Apriso?',
    answer:
      'Process Builder is Apriso\'s graphical workflow design tool. It allows manufacturing ' +
      'engineers to configure operation sequences, event-driven triggers, state transition ' +
      'logic, and exception handling rules — all without custom code. Processes are built as ' +
      'visual flowcharts and deployed to specific work centers, product families, or sites. ' +
      'Process libraries can be shared across multiple plants with site-level inheritance ' +
      'for local variations.',
    sourceTopics: ['Apriso_Configuration'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §6  COMBINED KNOWLEDGE BASE EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/** All knowledge chunks in a single flat array — ready for vector store ingestion */
export const ALL_KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  ...APRISO_CHUNKS,
  ...ORACLE_DB_CHUNKS,
  ...ORACLE_ERP_CHUNKS,
  ...INTEGRATION_CHUNKS,
];

/** Map from topic slug → chunk for O(1) lookup */
export const KNOWLEDGE_INDEX: Map<string, KnowledgeChunk> = new Map(
  ALL_KNOWLEDGE_CHUNKS.map(c => [c.topic, c])
);

/** Map from topic slug → Q&A pairs that reference it */
export const QA_BY_TOPIC: Map<string, QAPair[]> = new Map();
for (const qa of QA_DATASET) {
  for (const topic of qa.sourceTopics) {
    const existing = QA_BY_TOPIC.get(topic) ?? [];
    existing.push(qa);
    QA_BY_TOPIC.set(topic, existing);
  }
}

/**
 * Retrieve the most relevant knowledge chunks for a free-text query using
 * lightweight keyword matching. In production, replace this with a real
 * vector-similarity search (Pinecone, Weaviate, ChromaDB, etc.).
 */
export function retrieveChunks(query: string, topK = 5): KnowledgeChunk[] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (terms.length === 0) return ALL_KNOWLEDGE_CHUNKS.slice(0, topK);

  const scored = ALL_KNOWLEDGE_CHUNKS.map(chunk => {
    const text = `${chunk.title} ${chunk.content} ${(chunk.bullets ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = (text.match(new RegExp(term, 'g')) ?? []).length;
      score += count;
      // Boost exact topic-slug matches
      if (chunk.topic.toLowerCase().includes(term)) score += 5;
    }
    return { chunk, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.chunk);
}

/** Find Q&A pairs most relevant to a query */
export function retrieveQA(query: string, topK = 3): QAPair[] {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  return QA_DATASET
    .map(qa => {
      const text = `${qa.question} ${qa.answer}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      return { qa, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.qa);
}

/** Return all chunks for a specific category */
export function getChunksByCategory(category: KnowledgeCategory): KnowledgeChunk[] {
  return ALL_KNOWLEDGE_CHUNKS.filter(c => c.category === category);
}
