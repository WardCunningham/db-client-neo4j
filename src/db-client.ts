#!/bin/env node
import neo4j, { Session, Config, SessionConfig, ManagedTransaction } from "neo4j-driver"
import { Driver, TransactionConfig } from "neo4j-driver-core"
import { parseArgs, inspect } from 'node:util'

/** DB Client for Neo4j DB - implemented as functions (not classes)
 *  Usage:
 *    const db = newDbContext({dbName:'neo4j'})
 *    const arrayOfObjectResults = executeCypher(db, `return 'this is a test'`)
 *    dbClose(db)
 * 
 *  See main() method for detailed example that also acts as a CLI
 * 
 * Driver docs are at https://neo4j.com/docs/api/javascript-driver/current/
*/
export type DbParmsType = Partial<{
  positionals: string[];
  dbUrl: string;
  dbName: string;
  dbUser: string;
  dbPass: string;
  readonly: boolean;
  allowwrite: boolean;
  log: boolean;
  logresults: boolean;
  help: boolean;
}>

export let dbLogFn = null as unknown as Function // set to console.log, console.error or timestampedLog to enable logging

/** log function adds timestamp */
export function timestampedLog(msg: string, ...rest) {
  const dbLog = { [msg]: rest }
  console.error(new Date().toISOString(), dbLog)
}

export type DbQueryWithParametersType = {
  text: string,
  parameters?: { [parm: string]: any },
}

export type DbContextType = {
  dbParms: DbParmsType,
  dbDriverParms: Config,
  dbSessionParms: SessionConfig,
  dbTxnParms: TransactionConfig,
  dbDriver: Driver,
  dbSession: Session | null,
  dbTxn: ManagedTransaction | null,
  dbMarks: string[],  // lastBookmarks from session not dbDriver.BookmarkManager
  dbSummary: any, // flat JSON summary from last results
}

export type DbFunction<T = any> = (db: DbContextType, parameters?: { [key: string]: any }) => T

/** Provide CLI and programmatic access to Neo4j DB in nodejs */
export function newDbDriver(dbContextOrParms) {
  const dbParms = dbContextOrParms.dbParms ?? dbContextOrParms
  dbParms.dbDriverParms = { useBigInt: true, ...dbParms.dbDriverParms }
  return neo4j.driver(dbParms.dbUrl, neo4j.auth.basic(dbParms.dbUser, dbParms.dbPass), dbParms.dbDriverParms)
}

/** Shut down entire DB driver */
export async function dbClose(db: DbContextType) {
  await dbCloseSession(db)   // May not be explicitly needed, but let's be nice
  const res = await db?.dbDriver?.close()
  db.dbDriver = null
  return res
}

/** Close just the active session to the DB (so next request will get a fresh one) */
export async function dbCloseSession(db: DbContextType) {
  const res = await db?.dbSession?.close()
  db.dbSession = null
  return res
}

/** Note that DB is actually not contacted until first cypher query goes through, but driver may check url
 * Parms are normally DbParmsType the result of getParms() call but can also be pulled from another DbContextType
 * This can allow setting or overriding just certain dbSession or dbTxn parms as needed
 */
export function newDbContext(dbContextOrParms, overrides?): DbContextType {
  const dbParmsOverrides = overrides?.dbParms ?? overrides
  const dbParms = { ...(dbContextOrParms.dbParms ?? dbContextOrParms), ...dbParmsOverrides }
  dbParms[Symbol.for('nodejs.util.inspect.custom')] = (depth, options) => {  // Avoid logging password
    const { dbPass, ...rest } = { ...dbParms }
    delete rest[Symbol.for('nodejs.util.inspect.custom')]   //ugh
    return {
      ...rest,
      dbPass: dbPass == null ? null : '****',
    }
  }
  dbLogFn?.('newDbContext', dbParms)
  let db: DbContextType = {
    dbParms: dbParms,
    dbDriverParms: { ...dbParms.dbDriverParms, ...overrides?.dbDriverParms},
    dbSessionParms: { database: dbParms.dbName, ...dbParms.dbSessionParms, ...overrides?.dbSessionParms },
    dbTxnParms: { ...dbParms.dbTxnParms, ...overrides?.dbTxnParms },
    dbDriver: overrides?.dbDriver ?? dbParms.dbDriver,
    dbSession: null,
    dbTxn: null,
    dbMarks: overrides?.dbMarks ?? dbParms.dbMarks,
    dbSummary: null, // flat JSON summary from last results
  }
  if (db.dbDriver == null) {
    db.dbDriver = newDbDriver(dbParms)
    // db.dbSessionParms.bookmarkManager = db.dbDriver.executeQueryBookmarkManager // Can be used to ensure dbDriver.executeQuery is in sync with session.execute
  }
    if (!dbParms.allowwrite) {
    db.dbSessionParms.defaultAccessMode = 'READ'
  }
  return db
}

/** Handle causal cluster bookmarks so multiple sessions can remain in synch - at end of transaction or when closing a session */
export function dbHandleLastBookmarks(db) {
  const marks = db.dbSession?.lastBookmarks()
  db.dbMarks = marks
  db.dbSessionParms.bookmarks = marks
  // Note that if dbDriver.executeQuery is done, should share it's bookmarkmanager: https://neo4j.com/docs/javascript-manual/current/bookmarks/#_mix_executequery_and_sessions
}

/** Forget causal cluster bookmarks we may have saved up */
export function dbForgetBookmarks(db) {
  db.dbMarks = null
  db.dbSessionParms.bookmarks = null
}
 
/** Flatten DB query statistics with name/number pairs - avoid 0 values */
export function flatQueryStatistics(dbQueryStats) {
  return Object.fromEntries(Object.entries(dbQueryStats?._stats ?? {}).filter(([stat, num]) => +num > 0).map(e => e))
}

export function cleanupDbSummary(dbSummary) {
  // Note that plan and profile fields return deeperr objects if EXPLAIN or PROFILE is done - seem to log ok"
  dbSummary.counters = flatQueryStatistics(dbSummary.counters)
  dbSummary.updateStatistics = flatQueryStatistics(dbSummary.updateStatistics)
  return dbSummary
}

export async function dbResultAsObjects<T>(db: DbContextType, dbResult) {
  let recs: T[] = []
  const records = dbResult.records
  if (records == null || dbResult.summary?.counters == null) {  // already converted
    return dbResult
  }
  dbResult.records.forEach(rec => {
    recs.push(rec.toObject())
  })
  db.dbSummary = cleanupDbSummary(dbResult.summary)
  db.dbMarks = dbResult.bookmark
  // callers can do dbForgetBookmarks(db) if they really have no need for cross-session causal synchronization
  return recs
}

/** Execute a Cypher query or function ensuring results are converted to objects */
export async function executeCypher<T>(db: DbContextType, dbQuery: string | DbFunction | DbQueryWithParametersType, parameters?: { [key: string]: any }) {
  const results = await dbResultAsObjects<T>(db, await executeCypherRawResults<T>(db, dbQuery, parameters))
  if (db.dbParms.logresults) {
    timestampedLog('dbResult', dbQuery, results)
  }
  return results
}

/** Execute a Cypher query or function as a read/write transaction without converting results */
export async function executeCypherRawResults<T>(db: DbContextType, dbQuery: string | DbFunction | DbQueryWithParametersType, parameters?: { [key: string]: any }) {
  const isQueryFunction = typeof dbQuery === 'function'
  let dbQueryWithParms = dbQuery as DbQueryWithParametersType
  if (typeof dbQuery === 'string') {
    dbQueryWithParms = { text: dbQuery, parameters: parameters }
  } else if (parameters != null && !isQueryFunction) {
    dbQueryWithParms.parameters = { ...dbQueryWithParms.parameters, ...parameters }
  }
  dbLogFn?.('executeCypher', dbQuery, parameters)
  if (db.dbSession == null) {
    db.dbSession = db.dbDriver.session(db.dbSessionParms)
    if (!isQueryFunction) {  // Perform using single-transaction session.run call
      const dbResult = await db.dbSession.run(dbQueryWithParms.text, dbQueryWithParms.parameters, db.dbTxnParms)
      dbHandleLastBookmarks(db)
      return dbResult
    }
  }
  const dbQueryFn = isQueryFunction ? dbQuery : async (db: DbContextType) => {
    // causal consistency bookmarks are maintained within a transaction
    return await db.dbTxn.run(dbQueryWithParms.text, dbQueryWithParms.parameters)
  }
  if (db.dbTxn == null) {
    let dbResult = null
    try {
      if (db.dbSessionParms?.defaultAccessMode === 'READ') {
        dbResult = await db.dbSession.executeRead<T>(async (dbTxn) => {
          db.dbTxn = dbTxn
          return await dbQueryFn(db, parameters)
        }, db.dbTxnParms)
      } else {
        dbResult = await db.dbSession.executeWrite<T>(async (dbTxn) => {
          db.dbTxn = dbTxn
          return await dbQueryFn(db, parameters)
        }, db.dbTxnParms)
      }
    } finally {
      dbHandleLastBookmarks(db)
      db.dbTxn = null
    }
    return dbResult
  }
  return await dbQueryFn(db, parameters)  // Execute within existing transaction
}

/** Allow bigint to convert to JSON numeric and uint64 precisely (use string value if out of range)
*/
const MaxSafeInt_bigint = BigInt(Number.MAX_SAFE_INTEGER) // 2^53 - 1 = 9007199254740991
const MinSafeInt_bigint = BigInt(Number.MIN_SAFE_INTEGER) // - (2^53 - 1) = -900719925474099

/** Allow JSON.stringify() to work by default for BigInt - output precise number or string to avoid floating-point issues
 * This allows int64 types from DB driver to work (avoiding their Integer{low,high} objects workaround
 * setBigintHelperJson() must be called for this to take effect
 * Note that consumers need to use BigInt(xxx) on the field to get a legit bigint out of it
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
 * for more details and other approaches.
 */
export function setBigintHelperJson() {
  if (BigInt.prototype['toJSON'] == null) {
    BigInt.prototype['toJSON'] = function toJSON() {
      if (this > MaxSafeInt_bigint || this < MinSafeInt_bigint) {
        return this.toString() // Answers number in quoted string, or if target supports bigints can return raw digits via JSON.rawJSON(this.toString())
      } else {
        return Number(this) // Within precise range for floating-point integers
      }
    }
  }
}

/** Predefined functions for invocation from CLI - try not to use a Cypher keyword like match, return, profile, explain, with */
export const PredefinedDbFunctions: { [functionName: string]: DbFunction } = {
  ok: async (db) => { return await executeCypher(db, `return 'ok' as ok`) },
  echo: async (db, parms) => { return await executeCypher(db, `return $parms as parms`, { parms: parms }) },
  nodeCount: async (db) => { return await executeCypher(db, `match (n) return count(n) as nodeCount`) },
  initValueConstraint: async (db) => { return await executeCypher(db, `create constraint Value_name if not exists for (n:Value) require n.name is unique ;`) },
  setValue: async (db, parms) => { return await executeCypher(db, `merge (n:Value{name:$key}) set n.value=$value return n.value as value`, parms) },
  getAllValues: async (db) => { return await executeCypher(db, `match (n:Value) with properties(n) as props return apoc.map.fromPairs(collect([props.name,props.value])) as dict`) },
  getValue: async (db, parms) => { return await executeCypher(db, `match (n:Value) where n.name=$key return n.value as value`, parms) },
  testNestedParms: async (db, parms) => {
    const echoResult = await executeCypher(db, PredefinedDbFunctions.echo, parms)
    const countResult = await executeCypher(db, PredefinedDbFunctions.nodeCount)
    const r2 = await executeCypher(db, async (db, p1) => {
      return await executeCypher(db, PredefinedDbFunctions.echo, { p1: p1 })
    }, { parms: echoResult[0].parms, nodeCount: countResult[0].nodeCount })
    return r2
  },
}

/** Handle simple args from CLI as name:value */
export function queryParmsFromCLI(args: string[]) {
  return Object.fromEntries(args.map(e => e.split(':', 2)))
}

export function isValueTrue(valOrStr) {
  return valOrStr === true || '1yYtT+'.includes(valOrStr)
}

/** Answer parms from CLI or enviroment using node parseArgs */
export function getParms(args) {
  const pa = parseArgs({
    args: args, // process.argv.slice(2) used if null
    options: {
      dbUrl: {
        type: 'string',
        short: 'd',
      },
      dbName: {
        type: 'string',
        short: 'n'
      },
      dbUser: {
        type: 'string',
        short: 'u'
      },
      dbPass: {
        type: 'string',
        short: 'p'
      },
      readonly: {
        type: 'boolean',
        short: 'r',
      },
      allowwrite: {
        type: 'boolean',
        short: 'w',
      },
      log: {
        type: 'boolean',
        short: 'l',
      },
      logresults: {
        type: 'boolean',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
    allowPositionals: true,
    strict: true,
  })
  // Fixup with default values
  pa.values.dbName = pa.values.dbName ?? process.env.NEO4J_DBNAME  // default if null is neo4j
  pa.values.dbUrl = pa.values.dbUrl ?? process.env.NEO4J_DBURL ?? process.env.NEO4J_URI ?? 'neo4j://localhost:7687'
  pa.values.dbUser = pa.values.dbUser ?? process.env.NEO4J_USERNAME ?? 'neo4j'
  pa.values.dbPass = pa.values.dbPass ?? process.env.NEO4J_PASSWORD
  pa.values.allowwrite = pa.values.allowwrite ?? isValueTrue(process.env.NEO4J_ALLOWWRITE)
  if (pa.values.readonly) {
    pa.values.allowwrite = false
  }
  const firstArg = pa.positionals[0]
  pa.values.help = pa.values.help || firstArg === 'help' || firstArg === '?'
  return pa
}

export function help() {
  console.log(`yarn db-client [settings] "cypher query" [key1:val1] [key2:val2]
Execute a Neo4j cypher DB query or predefined functions, optionally passing in string key:value parameters 
that can be accessed in the query via neo4j $key references.

Default is to allow only read operations - no writing allowed.

Optional settings - some may be set by environment variables too:
 --dbUrl      | -d : Database URL - default from NEO4J_DBURL or NEO4J_URI
 --dbName     | -n : DB name - default from NEO4J_DBNAME or if not specified usually defaults to neo4j
 --dbUser     | -u : username - default from NEO4J_USERNAME
 --dbPass     | -p : password - default from NEO4J_PASSWORD
 --allowwrite | -w : allow writing to DB - can be set a default via NEO4J_ALLOWRITE=1
 --readonly   | -r : override allowwrite flag for this invocation (in case env variable is set)
 --log        | -l : log internal flows and DB response details to stderr
 --logresults      : log query and results to stderr (independent of --log)
 --help  | ?  | -h : Display this help

 PredefinedDbFunctions: ${Object.keys(PredefinedDbFunctions).join(' ')}
`)
}

export function handleCliArgs(args) {
  const { values, positionals } = getParms(args)
  const parms = { ...values, positionals: positionals }
  if (parms.help || positionals.length === 0) {
    help()
    return { dbParms: parms, query: null, queryParms: null }
  }
  let query: string | DbFunction | DbQueryWithParametersType = parms.positionals.join(' ')
  let queryParms = null
  if (query.length === 0) {
    query = `return 'ok' as ok`
  } else {
    const firstArg = parms.positionals[0]
    const dbFn = PredefinedDbFunctions[firstArg]
    if (dbFn != null) {
      query = dbFn
      queryParms = queryParmsFromCLI(parms.positionals.slice(1))
    } else if (firstArg.includes(' ')) { // First parameter is query with embedded spaces, rest are parms
      query = firstArg
      queryParms = queryParmsFromCLI(parms.positionals.slice(1))
    }
  }
  if (parms.log) {
    inspect.defaultOptions = { depth: 18, compact: 18, breakLength:240 }
    dbLogFn = timestampedLog
  }
  if (parms.logresults) {
    inspect.defaultOptions = { depth: 42, compact: 18, breakLength: 240 }  // Try to show more depth
  }
  return { dbParms: parms, query: query, queryParms: queryParms }
}

/** DB Client for Neo4j DB 
 * Note that this provides a CLI but is also an example of using the API.
 * Driver docs are at https://neo4j.com/docs/api/javascript-driver/current/
*/
export async function main(args) {
  const { dbParms, query, queryParms } = handleCliArgs(args)
  if (query == null) {
    return {}
  }
  const db = newDbContext(dbParms)
  let data = {}
  try {
    data = await executeCypher(db, query, queryParms)
  } finally {
    await dbClose(db)
  }
  dbLogFn?.('main', db)
  console.log(JSON.stringify({ result: data }))
  return data
}

export async function index(parms?) {
  return await main(parms ?? process.argv.slice(2)) // get only user-provided arguments
}

if (require.main === module) {
  // Run via CLI not require() or import {}
  setBigintHelperJson()
  index()
}

/** Ensure BigInt JSON support is available when loaded as a module */
setBigintHelperJson() 
