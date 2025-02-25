// Note that I'm using backticks for the cypher strings to allowjavascript variable substitution ${x} here vs.  Cypher variable substitution via $x)
async function update(db) {
 await executeCypher( db, `create constraint Station_name if not exists for (n:Station) require n.name is unique ;` );

 for (const node of graph.nodes) {
   await executeCypher( db, `merge (n:${node.type}{name:$name}) SET props+=$props`, 
     { name: node.props.name, props: node.props } );
 }

 for (const rel of graph.rels) {
   const fromName = graph.nodes[rel.from]?.props?.name
   const toName = graph.nodes[rel.to]?.props?.name
   if (fromName == null || toName == null) {
     throw new Error( `missing node name - fromName ${fromName} toName ${toName}` );
   }
   const fromLabel=graph.nodes[rel.from].type
   const toLabel=graph.nodes[rel.to].type
   await executeCypher(db, `merge (n:${fromLabel}{name:fromName})-[r:${rel.type}]->(p:${toLabel}{name:toName}) SET r+=relProps`,
      {fromName: fromName, toName: toName, relProps: rel.props }
   );
 }
}

async function main() {
 const db = newDbContext({}); // Set env vars right so no parms needed here
 try {
   await update(db);
 } finally {
   dbClose(db);
 }
}

