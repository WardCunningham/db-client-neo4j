import { dbLogFn, executeCypher, main, PredefinedDbFunctions } from './db-client'

/** Samples of adding DB functions to db-client and using it as an enhanced CLI
 *  With correct packages.json run script entry, can invoke via:
 *   yarn db-funcs --help
*/
function addMoreDbFunctions() {
  const p = PredefinedDbFunctions

  /** Note that without specifying a file, it streams everything in memory to the 'data' field.
  * Parms are: node label string (default Value) and number of results to limit it to (default 12)
  * Example invocation: 
  *   yarn db-funcs exportToCsv label:Value limit:200
  * 
  * Optionally, can pass a filename in, but exporting to a file places it in the Neo4j server filesystem,
  * which requires additional server settings in apoc.conf:
  *  apoc.export.file.enabled=true
  *  server.directories.import  is the directory that will be used
  * https://neo4j.com/docs/apoc/5/export/csv/*
  * https://neo4j.com/docs/apoc/5/overview/apoc.export/apoc.export.csv.query/
  * 
  * Note that we can set up appropriate rights in a local Neo4j instance and use container volume-mapping to export to host filesystem)
  * See running-neo4j.md  for how to set that up in a local neo4j DB container
  * 
  * Example invocation: 
  *   yarn db-funcs exportToCsv label:Value limit:200 file:values.csv
  */
  p.exportToCsv = async (db, parms) => {
    // Note that we use some javacript template values via ${xxx} substitution, and internal cypher parameter ones via $xxx
    const label = parms.label ?? 'Value'
    let filename = null
    let stream = true
    if (parms.file != null) {
      filename = parms.file
      stream = false
    }
    let limit = 12n
    try {
      limit = BigInt(parms.limit ?? 12)
    } catch (ex) {
      dbLogFn?.('exportToCsv', `limit ${parms.limit} not a number, default ${limit} used`)
    }
    return await executeCypher(db, `
call apoc.export.csv.query("match (n:${label}) return n.name as name, n.value as value limit $limit",
$filename,
{stream:$stream, timeoutSeconds:300, quotes:'ifNeeded', params:{limit: $limit}});
`, { limit: limit, stream: stream, filename: filename })
  }
}
  


  async function index(parms?) {
    addMoreDbFunctions()
    return await main(parms ?? process.argv.slice(2)) // get only user-provided arguments
  }

  if (require.main === module) {
    // Run via CLI not require() or import {}
    index()
  }
