/* ═══════════════════════════════════════════════════════════════════════════
   Oracle SQL & PL/SQL Builder
   ═══════════════════════════════════════════════════════════════════════════
   Type-safe query construction helpers for Oracle Database.
   Covers all function groups in the Trane knowledge base:
   String, Date, Numeric, Conversion, Aggregates, Window, PL/SQL packages.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OracleDateFormat =
  | 'YYYY-MM-DD'
  | 'DD-MON-YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY-MM-DD HH24:MI:SS'
  | 'DD-MON-YYYY HH:MI:SS AM'
  | string;

export type OracleDataType =
  | 'VARCHAR2'
  | 'NUMBER'
  | 'DATE'
  | 'TIMESTAMP'
  | 'CLOB'
  | 'BLOB'
  | 'INTEGER'
  | 'FLOAT'
  | 'CHAR'
  | 'NVARCHAR2';

export type SortDirection = 'ASC' | 'DESC';
export type NullsOrder = 'NULLS FIRST' | 'NULLS LAST';

export interface OrderByClause {
  column: string;
  direction?: SortDirection;
  nulls?: NullsOrder;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL OUTER' | 'CROSS';
  table: string;
  alias?: string;
  on: string;
}

export interface WindowSpec {
  partitionBy?: string[];
  orderBy?: OrderByClause[];
  frameClause?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// String Functions
// ─────────────────────────────────────────────────────────────────────────────

export const OracleStr = {
  substr:  (str: string, pos: number, len?: number) =>
    len !== undefined ? `SUBSTR(${str}, ${pos}, ${len})` : `SUBSTR(${str}, ${pos})`,
  instr:   (str: string, sub: string, pos = 1, occurrence = 1) =>
    `INSTR(${str}, ${sub}, ${pos}, ${occurrence})`,
  length:  (str: string) => `LENGTH(${str})`,
  lower:   (str: string) => `LOWER(${str})`,
  upper:   (str: string) => `UPPER(${str})`,
  initcap: (str: string) => `INITCAP(${str})`,
  replace: (str: string, search: string, replacement: string) =>
    `REPLACE(${str}, ${search}, ${replacement})`,
  regexpReplace: (str: string, pattern: string, replacement = '', pos = 1, occurrence = 0, flags = 'i') =>
    `REGEXP_REPLACE(${str}, '${pattern}', '${replacement}', ${pos}, ${occurrence}, '${flags}')`,
  trim:    (str: string) => `TRIM(${str})`,
  ltrim:   (str: string, chars?: string) =>
    chars ? `LTRIM(${str}, '${chars}')` : `LTRIM(${str})`,
  rtrim:   (str: string, chars?: string) =>
    chars ? `RTRIM(${str}, '${chars}')` : `RTRIM(${str})`,
  lpad:    (str: string, len: number, pad = ' ') => `LPAD(${str}, ${len}, '${pad}')`,
  rpad:    (str: string, len: number, pad = ' ') => `RPAD(${str}, ${len}, '${pad}')`,
  concat:  (...parts: string[]) => parts.join(' || '),
};

// ─────────────────────────────────────────────────────────────────────────────
// Date Functions
// ─────────────────────────────────────────────────────────────────────────────

export const OracleDate = {
  sysdate:       () => 'SYSDATE',
  currentDate:   () => 'CURRENT_DATE',
  addMonths:     (date: string, n: number) => `ADD_MONTHS(${date}, ${n})`,
  lastDay:       (date: string) => `LAST_DAY(${date})`,
  nextDay:       (date: string, day: string) => `NEXT_DAY(${date}, '${day}')`,
  monthsBetween: (d1: string, d2: string) => `MONTHS_BETWEEN(${d1}, ${d2})`,
  extract:       (part: 'YEAR' | 'MONTH' | 'DAY' | 'HOUR' | 'MINUTE' | 'SECOND', date: string) =>
    `EXTRACT(${part} FROM ${date})`,
  trunc:         (date: string, fmt?: string) =>
    fmt ? `TRUNC(${date}, '${fmt}')` : `TRUNC(${date})`,
  toChar:        (date: string, fmt: OracleDateFormat) => `TO_CHAR(${date}, '${fmt}')`,
  toDate:        (str: string, fmt: OracleDateFormat) => `TO_DATE(${str}, '${fmt}')`,
  toTimestamp:   (str: string, fmt: string) => `TO_TIMESTAMP(${str}, '${fmt}')`,
  interval:      (n: number, unit: 'DAY' | 'MONTH' | 'YEAR' | 'HOUR' | 'MINUTE' | 'SECOND') =>
    `INTERVAL '${n}' ${unit}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Numeric Functions
// ─────────────────────────────────────────────────────────────────────────────

export const OracleNum = {
  round:  (n: string, decimals = 0) => `ROUND(${n}, ${decimals})`,
  trunc:  (n: string, decimals = 0) => `TRUNC(${n}, ${decimals})`,
  floor:  (n: string) => `FLOOR(${n})`,
  ceil:   (n: string) => `CEIL(${n})`,
  abs:    (n: string) => `ABS(${n})`,
  power:  (base: string, exp: number) => `POWER(${base}, ${exp})`,
  sqrt:   (n: string) => `SQRT(${n})`,
  mod:    (m: string, divisor: number) => `MOD(${m}, ${divisor})`,
  sign:   (n: string) => `SIGN(${n})`,
  log:    (base: number, n: string) => `LOG(${base}, ${n})`,
  ln:     (n: string) => `LN(${n})`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversion & Null-Handling Functions
// ─────────────────────────────────────────────────────────────────────────────

export const OracleConv = {
  cast:      (val: string, type: OracleDataType, precision?: string) =>
    precision ? `CAST(${val} AS ${type}(${precision}))` : `CAST(${val} AS ${type})`,
  toChar:    (val: string, fmt?: string) =>
    fmt ? `TO_CHAR(${val}, '${fmt}')` : `TO_CHAR(${val})`,
  toNumber:  (str: string, fmt?: string) =>
    fmt ? `TO_NUMBER(${str}, '${fmt}')` : `TO_NUMBER(${str})`,
  toDate:    (str: string, fmt: OracleDateFormat) => `TO_DATE(${str}, '${fmt}')`,
  nvl:       (expr: string, def: string) => `NVL(${expr}, ${def})`,
  nvl2:      (expr: string, notNull: string, isNull: string) => `NVL2(${expr}, ${notNull}, ${isNull})`,
  nullif:    (a: string, b: string) => `NULLIF(${a}, ${b})`,
  coalesce:  (...args: string[]) => `COALESCE(${args.join(', ')})`,
  decode:    (expr: string, ...pairs: string[]) => `DECODE(${expr}, ${pairs.join(', ')})`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate Functions
// ─────────────────────────────────────────────────────────────────────────────

export const OracleAgg = {
  sum:      (col: string, distinct = false) => `SUM(${distinct ? 'DISTINCT ' : ''}${col})`,
  count:    (col = '*', distinct = false)   => `COUNT(${distinct ? 'DISTINCT ' : ''}${col})`,
  avg:      (col: string, distinct = false) => `AVG(${distinct ? 'DISTINCT ' : ''}${col})`,
  min:      (col: string) => `MIN(${col})`,
  max:      (col: string) => `MAX(${col})`,
  stddev:   (col: string) => `STDDEV(${col})`,
  variance: (col: string) => `VARIANCE(${col})`,
  median:   (col: string) => `MEDIAN(${col})`,
  listagg:  (col: string, delim = ',', orderByCol?: string) =>
    orderByCol
      ? `LISTAGG(${col}, '${delim}') WITHIN GROUP (ORDER BY ${orderByCol})`
      : `LISTAGG(${col}, '${delim}') WITHIN GROUP (ORDER BY ${col})`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Window / Analytic Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the OVER (...) clause string for an Oracle analytic (window) function.
 * Constructs PARTITION BY, ORDER BY, and optional frame clause from a WindowSpec.
 * Used internally by all OracleWin.* helpers.
 */
function buildWindowSpec(spec: WindowSpec): string {
  const parts: string[] = [];
  if (spec.partitionBy?.length) parts.push(`PARTITION BY ${spec.partitionBy.join(', ')}`);
  if (spec.orderBy?.length) {
    const ob = spec.orderBy
      .map(o => `${o.column}${o.direction ? ' ' + o.direction : ''}${o.nulls ? ' ' + o.nulls : ''}`)
      .join(', ');
    parts.push(`ORDER BY ${ob}`);
  }
  if (spec.frameClause) parts.push(spec.frameClause);
  return `OVER (${parts.join(' ')})`;
}

export const OracleWin = {
  rowNumber:   (spec: WindowSpec) => `ROW_NUMBER() ${buildWindowSpec(spec)}`,
  rank:        (spec: WindowSpec) => `RANK() ${buildWindowSpec(spec)}`,
  denseRank:   (spec: WindowSpec) => `DENSE_RANK() ${buildWindowSpec(spec)}`,
  ntile:       (n: number, spec: WindowSpec) => `NTILE(${n}) ${buildWindowSpec(spec)}`,
  lag:         (col: string, offset = 1, defVal?: string, spec?: WindowSpec) => {
    const args = defVal ? `${col}, ${offset}, ${defVal}` : `${col}, ${offset}`;
    return spec ? `LAG(${args}) ${buildWindowSpec(spec)}` : `LAG(${args})`;
  },
  lead:        (col: string, offset = 1, defVal?: string, spec?: WindowSpec) => {
    const args = defVal ? `${col}, ${offset}, ${defVal}` : `${col}, ${offset}`;
    return spec ? `LEAD(${args}) ${buildWindowSpec(spec)}` : `LEAD(${args})`;
  },
  firstValue:  (col: string, spec: WindowSpec) => `FIRST_VALUE(${col}) ${buildWindowSpec(spec)}`,
  lastValue:   (col: string, spec: WindowSpec) => `LAST_VALUE(${col}) ${buildWindowSpec(spec)}`,
  sumOver:     (col: string, spec: WindowSpec) => `SUM(${col}) ${buildWindowSpec(spec)}`,
  avgOver:     (col: string, spec: WindowSpec) => `AVG(${col}) ${buildWindowSpec(spec)}`,
  countOver:   (col: string, spec: WindowSpec) => `COUNT(${col}) ${buildWindowSpec(spec)}`,
  /** Convenience: running total */
  runningTotal: (col: string, orderByCol: string) =>
    OracleWin.sumOver(col, { orderBy: [{ column: orderByCol }] }),
  /** Convenience: N-period moving average */
  movingAvg: (col: string, orderByCol: string, periods: number) =>
    OracleWin.avgOver(col, {
      orderBy: [{ column: orderByCol }],
      frameClause: `ROWS BETWEEN ${periods - 1} PRECEDING AND CURRENT ROW`,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// SELECT Query Builder
// ─────────────────────────────────────────────────────────────────────────────

export class OracleQueryBuilder {
  private _select: string[] = [];
  private _from = '';
  private _joins: JoinClause[] = [];
  private _where: string[] = [];
  private _groupBy: string[] = [];
  private _having: string[] = [];
  private _orderBy: OrderByClause[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;
  private _hints: string[] = [];

  select(...cols: string[]): this {
    this._select.push(...cols);
    return this;
  }

  from(table: string, alias?: string): this {
    this._from = alias ? `${table} ${alias}` : table;
    return this;
  }

  join(clause: JoinClause): this {
    this._joins.push(clause);
    return this;
  }

  innerJoin(table: string, on: string, alias?: string): this {
    return this.join({ type: 'INNER', table, on, alias });
  }

  leftJoin(table: string, on: string, alias?: string): this {
    return this.join({ type: 'LEFT', table, on, alias });
  }

  where(...conditions: string[]): this {
    this._where.push(...conditions);
    return this;
  }

  groupBy(...cols: string[]): this {
    this._groupBy.push(...cols);
    return this;
  }

  having(...conditions: string[]): this {
    this._having.push(...conditions);
    return this;
  }

  orderBy(...clauses: OrderByClause[]): this {
    this._orderBy.push(...clauses);
    return this;
  }

  /** Oracle 12c+ row limiting (FETCH FIRST n ROWS ONLY) */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /** Oracle optimizer hints e.g. 'INDEX(t IDX_ITEM)' */
  hint(...hints: string[]): this {
    this._hints.push(...hints);
    return this;
  }

  build(): string {
    if (!this._from) throw new Error('OracleQueryBuilder: FROM clause is required');

    const hintStr = this._hints.length ? ` /*+ ${this._hints.join(' ')} */` : '';
    const selectStr = this._select.length ? this._select.join(',\n       ') : '*';
    let sql = `SELECT${hintStr}\n       ${selectStr}\n  FROM ${this._from}`;

    for (const j of this._joins) {
      const alias = j.alias ? ` ${j.alias}` : '';
      sql += `\n  ${j.type} JOIN ${j.table}${alias} ON ${j.on}`;
    }

    if (this._where.length) {
      sql += `\n WHERE ${this._where.join('\n   AND ')}`;
    }

    if (this._groupBy.length) {
      sql += `\n GROUP BY ${this._groupBy.join(', ')}`;
    }

    if (this._having.length) {
      sql += `\nHAVING ${this._having.join('\n   AND ')}`;
    }

    if (this._orderBy.length) {
      const ob = this._orderBy
        .map(o => `${o.column}${o.direction ? ' ' + o.direction : ''}${o.nulls ? ' ' + o.nulls : ''}`)
        .join(', ');
      sql += `\n ORDER BY ${ob}`;
    }

    if (this._offset !== null) {
      sql += `\nOFFSET ${this._offset} ROWS`;
    }

    if (this._limit !== null) {
      sql += `\n FETCH FIRST ${this._limit} ROWS ONLY`;
    }

    return sql;
  }

  /** Wrap as a Common Table Expression */
  asCTE(name: string): string {
    return `${name} AS (\n${this.build()}\n)`;
  }

  reset(): this {
    this._select = [];
    this._from = '';
    this._joins = [];
    this._where = [];
    this._groupBy = [];
    this._having = [];
    this._orderBy = [];
    this._limit = null;
    this._offset = null;
    this._hints = [];
    return this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PL/SQL Package Catalog
// ─────────────────────────────────────────────────────────────────────────────

export interface PLSQLPackageInfo {
  name: string;
  purpose: string;
  commonProcedures: Array<{ name: string; signature: string; description: string }>;
  notes?: string;
}

export const PLSQL_PACKAGES: PLSQLPackageInfo[] = [
  {
    name: 'DBMS_OUTPUT',
    purpose: 'Write debug/log messages to console or buffer during PL/SQL execution.',
    commonProcedures: [
      { name: 'PUT_LINE', signature: "DBMS_OUTPUT.PUT_LINE(msg VARCHAR2)", description: 'Write a line to the output buffer' },
      { name: 'PUT',      signature: "DBMS_OUTPUT.PUT(msg VARCHAR2)",      description: 'Write without newline' },
      { name: 'NEW_LINE', signature: "DBMS_OUTPUT.NEW_LINE",               description: 'Write a newline' },
      { name: 'ENABLE',   signature: "DBMS_OUTPUT.ENABLE(buffer_size INT)", description: 'Enable buffering' },
      { name: 'DISABLE',  signature: "DBMS_OUTPUT.DISABLE",                description: 'Disable and clear buffer' },
    ],
  },
  {
    name: 'DBMS_SCHEDULER',
    purpose: 'Schedule and manage database jobs with cron-like precision, event triggers, and job chains.',
    commonProcedures: [
      { name: 'CREATE_JOB',    signature: "DBMS_SCHEDULER.CREATE_JOB(job_name, job_type, job_action, schedule_name, ...)", description: 'Create a scheduled job' },
      { name: 'RUN_JOB',       signature: "DBMS_SCHEDULER.RUN_JOB(job_name)",          description: 'Run a job immediately' },
      { name: 'DISABLE',       signature: "DBMS_SCHEDULER.DISABLE(name)",               description: 'Disable a job or schedule' },
      { name: 'ENABLE',        signature: "DBMS_SCHEDULER.ENABLE(name)",                description: 'Enable a job or schedule' },
      { name: 'DROP_JOB',      signature: "DBMS_SCHEDULER.DROP_JOB(job_name)",          description: 'Remove a job' },
      { name: 'SET_ATTRIBUTE', signature: "DBMS_SCHEDULER.SET_ATTRIBUTE(name, attribute, value)", description: 'Modify job attributes' },
    ],
    notes: 'Supports PLSQL_BLOCK, STORED_PROCEDURE, and EXECUTABLE job types. Use ALL_SCHEDULER_JOBS view to inspect.',
  },
  {
    name: 'UTL_FILE',
    purpose: 'Read and write operating system files from PL/SQL programs.',
    commonProcedures: [
      { name: 'FOPEN',   signature: "UTL_FILE.FOPEN(location, filename, open_mode, max_linesize) RETURN UTL_FILE.FILE_TYPE", description: 'Open a file for R/W/A' },
      { name: 'PUT_LINE', signature: "UTL_FILE.PUT_LINE(file, buffer)",  description: 'Write a line to file' },
      { name: 'GET_LINE', signature: "UTL_FILE.GET_LINE(file, buffer)",  description: 'Read a line from file' },
      { name: 'FCLOSE',  signature: "UTL_FILE.FCLOSE(file)",            description: 'Close a file handle' },
      { name: 'FFLUSH',  signature: "UTL_FILE.FFLUSH(file)",            description: 'Flush write buffer' },
    ],
    notes: 'Requires a DIRECTORY object defined in Oracle. open_mode: r=read, w=write, a=append.',
  },
  {
    name: 'UTL_HTTP',
    purpose: 'Make HTTP/HTTPS requests from PL/SQL — useful for calling REST APIs from Oracle.',
    commonProcedures: [
      { name: 'BEGIN_REQUEST',  signature: "UTL_HTTP.BEGIN_REQUEST(url, method, http_version) RETURN UTL_HTTP.REQ", description: 'Initiate an HTTP request' },
      { name: 'SET_HEADER',     signature: "UTL_HTTP.SET_HEADER(r UTL_HTTP.REQ, name, value)", description: 'Add request header' },
      { name: 'WRITE_TEXT',     signature: "UTL_HTTP.WRITE_TEXT(r UTL_HTTP.REQ, data)",        description: 'Write request body' },
      { name: 'GET_RESPONSE',   signature: "UTL_HTTP.GET_RESPONSE(r UTL_HTTP.REQ) RETURN UTL_HTTP.RESP", description: 'Get the HTTP response' },
      { name: 'READ_TEXT',      signature: "UTL_HTTP.READ_TEXT(r UTL_HTTP.RESP, data, len)",   description: 'Read response body' },
      { name: 'END_RESPONSE',   signature: "UTL_HTTP.END_RESPONSE(r UTL_HTTP.RESP)",           description: 'Close the response' },
    ],
    notes: 'Requires EXECUTE privilege on UTL_HTTP and ACL network permissions to the target host.',
  },
  {
    name: 'DBMS_LOB',
    purpose: 'Manage Large Object (LOB) data types: CLOB, BLOB, NCLOB, BFILE.',
    commonProcedures: [
      { name: 'GETLENGTH', signature: "DBMS_LOB.GETLENGTH(lob) RETURN INTEGER",          description: 'Get LOB character/byte count' },
      { name: 'READ',      signature: "DBMS_LOB.READ(lob, amount, offset, buffer)",      description: 'Read LOB data into buffer' },
      { name: 'WRITE',     signature: "DBMS_LOB.WRITE(lob, amount, offset, buffer)",     description: 'Write data into LOB' },
      { name: 'APPEND',    signature: "DBMS_LOB.APPEND(dest_lob, src_lob)",              description: 'Append one LOB to another' },
      { name: 'SUBSTR',    signature: "DBMS_LOB.SUBSTR(lob, amount, offset) RETURN RAW", description: 'Extract LOB substring' },
      { name: 'INSTR',     signature: "DBMS_LOB.INSTR(lob, pattern, offset, nth)",       description: 'Search LOB for pattern' },
    ],
  },
  {
    name: 'DBMS_CRYPTO',
    purpose: 'Encryption, decryption, hashing, and MAC generation in PL/SQL.',
    commonProcedures: [
      { name: 'ENCRYPT', signature: "DBMS_CRYPTO.ENCRYPT(src RAW, typ INTEGER, key RAW, iv RAW) RETURN RAW", description: 'Encrypt data (AES, 3DES, DES)' },
      { name: 'DECRYPT', signature: "DBMS_CRYPTO.DECRYPT(src RAW, typ INTEGER, key RAW, iv RAW) RETURN RAW", description: 'Decrypt data' },
      { name: 'HASH',    signature: "DBMS_CRYPTO.HASH(src RAW, typ INTEGER) RETURN RAW",                    description: 'Hash data (SHA-1, SHA-256, MD5)' },
      { name: 'MAC',     signature: "DBMS_CRYPTO.MAC(src RAW, typ INTEGER, key RAW) RETURN RAW",            description: 'HMAC generation' },
    ],
    notes: 'Constants: ENCRYPT_AES256=6, ENCRYPT_3DES_2KEY=4, HASH_SHA256=3, HASH_MD5=2.',
  },
  {
    name: 'DBMS_STATS',
    purpose: 'Gather and manage optimizer statistics to ensure efficient query execution plans.',
    commonProcedures: [
      { name: 'GATHER_TABLE_STATS',  signature: "DBMS_STATS.GATHER_TABLE_STATS(ownname, tabname, estimate_percent, cascade)", description: 'Gather table and column statistics' },
      { name: 'GATHER_SCHEMA_STATS', signature: "DBMS_STATS.GATHER_SCHEMA_STATS(ownname, estimate_percent)",                  description: 'Gather all objects in a schema' },
      { name: 'DELETE_TABLE_STATS',  signature: "DBMS_STATS.DELETE_TABLE_STATS(ownname, tabname)",                            description: 'Remove statistics' },
      { name: 'LOCK_TABLE_STATS',    signature: "DBMS_STATS.LOCK_TABLE_STATS(ownname, tabname)",                              description: 'Prevent auto-stats updates' },
    ],
  },
];

/** Look up a PL/SQL package by name */
export function getPLSQLPackage(name: string): PLSQLPackageInfo | undefined {
  return PLSQL_PACKAGES.find(p => p.name.toUpperCase() === name.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Dictionary View Catalog
// ─────────────────────────────────────────────────────────────────────────────

export interface DataDictionaryView {
  name: string;
  scope: 'USER' | 'ALL' | 'DBA' | 'V$';
  description: string;
  keyColumns: string[];
}

export const DATA_DICTIONARY_VIEWS: DataDictionaryView[] = [
  // USER_ views
  { name: 'USER_TABLES',       scope: 'USER', description: 'Tables owned by current user',         keyColumns: ['TABLE_NAME', 'NUM_ROWS', 'BLOCKS', 'LAST_ANALYZED'] },
  { name: 'USER_TAB_COLUMNS',  scope: 'USER', description: 'Column definitions for owned tables',  keyColumns: ['TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'NULLABLE', 'DATA_DEFAULT'] },
  { name: 'USER_OBJECTS',      scope: 'USER', description: 'All objects owned by current user',    keyColumns: ['OBJECT_NAME', 'OBJECT_TYPE', 'STATUS', 'LAST_DDL_TIME'] },
  { name: 'USER_SOURCE',       scope: 'USER', description: 'PL/SQL source for owned objects',      keyColumns: ['NAME', 'TYPE', 'LINE', 'TEXT'] },
  { name: 'USER_INDEXES',      scope: 'USER', description: 'Indexes on owned tables',              keyColumns: ['INDEX_NAME', 'TABLE_NAME', 'INDEX_TYPE', 'UNIQUENESS'] },
  { name: 'USER_CONSTRAINTS',  scope: 'USER', description: 'Constraints on owned tables',          keyColumns: ['CONSTRAINT_NAME', 'TABLE_NAME', 'CONSTRAINT_TYPE', 'STATUS'] },
  // ALL_ views
  { name: 'ALL_TABLES',        scope: 'ALL',  description: 'Tables accessible to current user',    keyColumns: ['OWNER', 'TABLE_NAME', 'NUM_ROWS'] },
  { name: 'ALL_TAB_PRIVS',     scope: 'ALL',  description: 'Privileges on accessible objects',     keyColumns: ['GRANTEE', 'OWNER', 'TABLE_NAME', 'PRIVILEGE'] },
  { name: 'ALL_OBJECTS',       scope: 'ALL',  description: 'All accessible database objects',      keyColumns: ['OWNER', 'OBJECT_NAME', 'OBJECT_TYPE', 'STATUS'] },
  // DBA_ views
  { name: 'DBA_TABLES',        scope: 'DBA',  description: 'All tables in the database',           keyColumns: ['OWNER', 'TABLE_NAME', 'NUM_ROWS', 'TABLESPACE_NAME'] },
  { name: 'DBA_USERS',         scope: 'DBA',  description: 'All database users',                   keyColumns: ['USERNAME', 'ACCOUNT_STATUS', 'DEFAULT_TABLESPACE', 'CREATED'] },
  { name: 'DBA_SOURCE',        scope: 'DBA',  description: 'All PL/SQL source code',               keyColumns: ['OWNER', 'NAME', 'TYPE', 'LINE', 'TEXT'] },
  { name: 'DBA_SEGMENTS',      scope: 'DBA',  description: 'Storage segment information',          keyColumns: ['OWNER', 'SEGMENT_NAME', 'SEGMENT_TYPE', 'BYTES'] },
  // V$ performance views
  { name: 'V$SESSION',         scope: 'V$',   description: 'Active sessions',                      keyColumns: ['SID', 'SERIAL#', 'USERNAME', 'STATUS', 'SQL_ID', 'MACHINE'] },
  { name: 'V$SQL',             scope: 'V$',   description: 'SQL statements in shared pool',        keyColumns: ['SQL_ID', 'SQL_TEXT', 'EXECUTIONS', 'ELAPSED_TIME', 'BUFFER_GETS'] },
  { name: 'V$LOCK',            scope: 'V$',   description: 'Current lock holders and waiters',     keyColumns: ['SID', 'TYPE', 'ID1', 'ID2', 'LMODE', 'REQUEST'] },
  { name: 'V$SYSTEM_EVENT',    scope: 'V$',   description: 'System-wide wait event statistics',    keyColumns: ['EVENT', 'TOTAL_WAITS', 'TIME_WAITED', 'AVERAGE_WAIT'] },
];

/** Find data dictionary views by scope */
export function getViewsByScope(scope: DataDictionaryView['scope']): DataDictionaryView[] {
  return DATA_DICTIONARY_VIEWS.filter(v => v.scope === scope);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built Manufacturing Query Templates
// ─────────────────────────────────────────────────────────────────────────────

export const MANUFACTURING_QUERIES = {
  /**
   * Work order completion summary by date range
   * Mirrors Oracle Discrete Manufacturing WIP_DISCRETE_JOBS
   */
  workOrderSummary: (startDate: string, endDate: string) =>
    new OracleQueryBuilder()
      .select(
        'wdj.WIP_ENTITY_NAME   AS work_order',
        'wdj.DESCRIPTION       AS description',
        "TO_CHAR(wdj.SCHEDULED_START_DATE, 'YYYY-MM-DD') AS scheduled_start",
        "TO_CHAR(wdj.SCHEDULED_COMPLETION_DATE, 'YYYY-MM-DD') AS scheduled_end",
        'wdj.START_QUANTITY',
        'wdj.QUANTITY_COMPLETED',
        'wdj.QUANTITY_SCRAPPED',
        OracleNum.round(`wdj.QUANTITY_COMPLETED / NULLIF(wdj.START_QUANTITY,0) * 100`, 1) + ' AS completion_pct',
        'wdj.STATUS_TYPE',
      )
      .from('WIP_DISCRETE_JOBS', 'wdj')
      .where(
        `wdj.ORGANIZATION_ID = :org_id`,
        `wdj.SCHEDULED_START_DATE >= TO_DATE('${startDate}', 'YYYY-MM-DD')`,
        `wdj.SCHEDULED_START_DATE <  TO_DATE('${endDate}', 'YYYY-MM-DD')`,
      )
      .orderBy({ column: 'wdj.SCHEDULED_START_DATE', direction: 'DESC' })
      .build(),

  /**
   * Material consumption vs. standard for work orders (variance analysis)
   */
  materialVariance: () =>
    new OracleQueryBuilder()
      .select(
        'wdj.WIP_ENTITY_NAME',
        'msi.SEGMENT1          AS item_number',
        'msi.DESCRIPTION       AS item_description',
        'wro.REQUIRED_QUANTITY  AS std_qty',
        OracleAgg.sum('wmt.PRIMARY_TRANSACTION_QUANTITY') + ' AS actual_qty',
        OracleNum.round(
          `SUM(wmt.PRIMARY_TRANSACTION_QUANTITY) - wro.REQUIRED_QUANTITY`, 4
        ) + ' AS variance_qty',
      )
      .from('WIP_DISCRETE_JOBS', 'wdj')
      .innerJoin('WIP_REQUIREMENT_OPERATIONS', 'wro ON wro.WIP_ENTITY_ID = wdj.WIP_ENTITY_ID', 'wro')
      .innerJoin('MTL_SYSTEM_ITEMS_B',         'msi ON msi.INVENTORY_ITEM_ID = wro.INVENTORY_ITEM_ID AND msi.ORGANIZATION_ID = wdj.ORGANIZATION_ID', 'msi')
      .leftJoin('WIP_MATERIAL_TRANSACTIONS',   'wmt ON wmt.WIP_ENTITY_ID = wdj.WIP_ENTITY_ID AND wmt.INVENTORY_ITEM_ID = wro.INVENTORY_ITEM_ID', 'wmt')
      .where('wdj.ORGANIZATION_ID = :org_id', 'wdj.STATUS_TYPE IN (3,4,5)')
      .groupBy('wdj.WIP_ENTITY_NAME', 'msi.SEGMENT1', 'msi.DESCRIPTION', 'wro.REQUIRED_QUANTITY')
      .having(`ABS(SUM(wmt.PRIMARY_TRANSACTION_QUANTITY) - wro.REQUIRED_QUANTITY) > 0`)
      .orderBy({ column: 'variance_qty', direction: 'DESC' })
      .build(),

  /**
   * Inventory on-hand snapshot by subinventory
   */
  inventoryOnHand: (orgId: number) =>
    new OracleQueryBuilder()
      .select(
        'msi.SEGMENT1         AS item_number',
        'msi.DESCRIPTION',
        'moq.SUBINVENTORY_CODE',
        'moq.LOT_NUMBER',
        OracleAgg.sum('moq.PRIMARY_TRANSACTION_QUANTITY') + ' AS on_hand_qty',
        'msi.PRIMARY_UOM_CODE AS uom',
        OracleNum.round(
          `SUM(moq.PRIMARY_TRANSACTION_QUANTITY) * msi.STANDARD_COST`, 2
        ) + ' AS inventory_value',
      )
      .from('MTL_ONHAND_QUANTITIES_DETAIL', 'moq')
      .innerJoin('MTL_SYSTEM_ITEMS_B', 'msi ON msi.INVENTORY_ITEM_ID = moq.INVENTORY_ITEM_ID AND msi.ORGANIZATION_ID = moq.ORGANIZATION_ID', 'msi')
      .where(`moq.ORGANIZATION_ID = ${orgId}`, `moq.PRIMARY_TRANSACTION_QUANTITY > 0`)
      .groupBy('msi.SEGMENT1', 'msi.DESCRIPTION', 'moq.SUBINVENTORY_CODE', 'moq.LOT_NUMBER', 'msi.PRIMARY_UOM_CODE', 'msi.STANDARD_COST')
      .orderBy({ column: 'inventory_value', direction: 'DESC' })
      .build(),

  /**
   * AP invoice aging with payment status
   */
  invoiceAging: () =>
    new OracleQueryBuilder()
      .select(
        'pv.VENDOR_NAME',
        'aia.INVOICE_NUM',
        "TO_CHAR(aia.INVOICE_DATE, 'YYYY-MM-DD')  AS invoice_date",
        "TO_CHAR(aia.PAYMENT_STATUS_FLAG)          AS payment_status",
        'aia.INVOICE_AMOUNT',
        'aia.AMOUNT_PAID',
        OracleNum.round('aia.INVOICE_AMOUNT - aia.AMOUNT_PAID', 2) + ' AS amount_due',
        `CASE
          WHEN SYSDATE - aia.DUE_DATE <= 0  THEN 'Current'
          WHEN SYSDATE - aia.DUE_DATE <= 30 THEN '1-30 days'
          WHEN SYSDATE - aia.DUE_DATE <= 60 THEN '31-60 days'
          WHEN SYSDATE - aia.DUE_DATE <= 90 THEN '61-90 days'
          ELSE 'Over 90 days'
         END AS aging_bucket`,
      )
      .from('AP_INVOICES_ALL', 'aia')
      .innerJoin('PO_VENDORS', 'pv ON pv.VENDOR_ID = aia.VENDOR_ID', 'pv')
      .where(
        "aia.PAYMENT_STATUS_FLAG != 'Y'",
        "aia.CANCELLED_DATE IS NULL",
        'aia.ORG_ID = :org_id',
      )
      .orderBy({ column: 'aia.DUE_DATE' })
      .build(),
};
