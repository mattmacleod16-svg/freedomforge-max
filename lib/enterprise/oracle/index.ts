/* Oracle module index */
export { OracleQueryBuilder, OracleStr, OracleDate, OracleNum, OracleConv, OracleAgg, OracleWin, PLSQL_PACKAGES, DATA_DICTIONARY_VIEWS, MANUFACTURING_QUERIES, getPLSQLPackage, getViewsByScope } from './sql-builder';
export type { OracleDateFormat, OracleDataType, SortDirection, WindowSpec, PLSQLPackageInfo, DataDictionaryView } from './sql-builder';

export { ALL_ERP_MODULES, ERP_MODULE_INDEX, FINANCIALS_MODULES, SCM_MODULES, HCM_MODULES, REPORTING_MODULES, getERPModule, getModulesBySuite, getModulesWithAprisoIntegration } from './erp-modules';
export type { ERPModule, ERPModuleInfo } from './erp-modules';
