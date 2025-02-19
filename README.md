# Neo4j Typescript Client

Thin wrapper for Neo4j DB Javascript driver: https://neo4j.com/docs/api/javascript-driver/current/

From command-line, initial setup to select correct version of nodejs and pull in libraries:
```
nvm use 
node --version
npm install
npm run build
npm run cypher --help
```

You can also use `yarn` to run things instead (here we install it your default node environment using the -g option):
```
npm install -g yarn
yarn build
yarn cypher --help
```

For native windows `nvm-windows` can be used to manage nodejs versions: https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-windows#install-nvm-windows-nodejs-and-npm (`winget install CoreyButler.NVMforWindows`)
and you may need to initially setup via `nvm install 22.13.1` and `nvm use 22.13.1` since it does not read the `.nvmrc` file.

To provide to provide linux-like CLI to run things, windows can use WSL Windows Subsystem for Linux https://learn.microsoft.com/en-us/windows/wsl/install (native with windows `wsl --install` or `winget install Microsoft.WSL` ),
git-bash https://gitforwindows.org/ (lighter, easy-to-install `winget install Git.Git`),
or Cygwin https://www.redhat.com/en/blog/hybrid-system-cygwin (more complex setup options `winget install Cygwin.Cygwin`).

Note that in the xamples below `npm run xxx`  can be used instead of `yarn xxx` if you don't want to install yarn.

If you have a local server on neo4j://localhost:7687, can run one of our predefined functions to check connectivity and node counts, or do a real query:
```
export NEO4J_PASSWORD=pickapassw0rd
export NEO4J_USERNAME=neo4j
yarn cypher ok
yarn cypher nodeCount
yarn cypher "match ()-[r]->() return count(r) as numRelationships;"
```

Use the `--log` parameter to show more internal details.

By default you get a readonly connection (no writes allowed).  You can pass an `--allowwrite` parameter to allow updates and deletes (be careful!).  This can also be set as a default by setting the environment variable `NEO4J_ALLOWWRITE=1`
You can explicitly specify a read-only connection for a particular invocation via the `--readonly` parameter.

Connectivity parameters can be passed via environment variables or command-line:
```
export NEO4J_PASSWORD=pickapassw0rd
export NEO4J_USERNAME=neo4j
export NEO4J_DBURL=neo4j+s://abcd5678.databases.neo4j.io:7687
export NEO4J_DBNAME=neo4j
yarn cypher echo foo:bar param2:2

NEO4J_PASSWORD=pickapassw0rd 
yarn cypher --dbUrl 'neo4j://localhost:7687' echo foo:bar param2:2
```

The last syntax allows passing string parameters from the CLI.  You need to be careful about nesting single and double quotes correctly, and for most CLI shells characters like dollar-sign ($) need special handling when specifying queries:
```
yarn cypher --allowwrite "merge (n:Value{name:'foo'}) SET n.value='bar' return n.value as value"
yarn cypher "match (n:Value) where n.name=\$findName return properties(n) as props;" findName:foo
```

Here are some more variations, creating a Value node label with unique 'name' field as a key:
```
yarn cypher --allowwrite "create constraint Value_name if not exists for (n:Value) require n.name is unique ;"
yarn cypher --allowwrite  "merge (n:Value{name:'rightnow'}) set n.value=toString(datetime()) return n.value as value ;"
yarn cypher --allowwrite "merge (n:Value{name:\$key}) set n.value=\$value return n.value as value ;" key:key1 "value:value for key1"
yarn cypher "match (n:Value) with properties(n) as keyVal return keyVal"
yarn cypher "match (n:Value) return collect(n {.*}) as keyVals"
yarn cypher "match (n:Value) with properties(n) as props return apoc.map.fromPairs(collect([props.name,props.value])) as dict"
```


## Writing new DB functions
See the `PredefinedDbFunctions` table in [db-client.ts](./src/db-client.ts) for examples of how to use the API functions, and the `main()` function to see how `executeCypher()` is used to invoke a Cypher query by string or javascript function given a specific DB context setup via the `newDbContext()` function.   The `dbResultAsObjects()` function create javascript objects out of the raw result set.

An example of how to include `db-client` as a module and enhance the available db functions is in `db-func.ts`(./src/db-func.ts).

Note that various advanced  parameters for sessions and transactions may be set - VSCode typescript plugin should be helpful and o guide you to appropriate code comments, and the online docs for the Neo4j javascript driver are at https://neo4j.com/docs/api/javascript-driver/current/.

## Potential Enhancements
* use the Neo4j DbResult in a streaming mode to allow larger-than-memory results (can be redirected to a file) `dbResultAsStream()`
* Handle invocations from a browser web client
* Use browser typescript support via Module Shims 2.0 - support typescript type erasure https://github.com/guybedford/es-module-shims (Guy Bedford 2025-02-27): https://guybedford.com/es-module-shims-2.0

## Web client Development
Snippets for code for web development (WIP)
Issues with CORS and WebSockets may need to be addressed.

Note that we install yarn and http-server in the global path:
```
npm install -g yarn
npm install -g http-server
```

Start http server for web client (avoiding CORS issues with local files)
```
yarn build-web
yarn start-web
```

## Local Neo4j
For some tips on running a local Neo4j instance, see [running-neo4j.md](./running-neo4j.md)

You may find it easier to allocate a free Aura instance instead at https://console-preview.neo4j.io - make sure to collect the username and password when you create it.   The URL will be something like `neo4j+s://abcd5678.databases.neo4j.io:7687` with `abcd5678` being your database instance id.
