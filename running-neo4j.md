# Running a local Neo4j DB

## Running a local Neo4j DB container via docker or podman 

Create a home on the host for data `mkdir -p $HOME/neo4j/neodb`,  plugins `mkdir -p $HOME/neo4j/plugins`, and imports/exports `mkdir -p $HOME/neo4j/import`

The APOC plugin is really useful, the `NEO4J_PLUGINS` environment varible can be used to download and configure it when the container is first created.   You can also download the APOC core plugin and place in the plugin directory yourself if the container cannot access the internet.  Further directions are at https://neo4j.com/docs/apoc/5/installation/#neo4j-server .
For instance download apoc-5.26.2-core.jar from https://github.com/neo4j/apoc/releases/tag/5.26.2

Then we mount those host directories into the container so that DB data remains in the host filesystem, not in the container filesystem.

Example `start-neo4j.sh` script (used on Linux / git-bash or within WSL2 with `WINUSERDIR` pointing to mounted windows host home USERPROFILE directory e.g. `/mnt/c/Users/myWindowsUserid`)
```
#!/bin/bash
PODNAME=neodb
NEODIR="${WINUSERDIR:-${HOME}}/neo4j"
echo "Neo4j DB $PODNAME in $NEODIR"
# https://hub.docker.com/_/neo4j
# Include APOC Core jar:  place apoc-5.26.2-core.jar from https://github.com/neo4j/apoc/releases/tag/5.26.2 in plugins and mount at /plugins
podman container exists $PODNAME
rc=$?
if [ $rc -eq 0 ]; then
  podman container start -i --attach $PODNAME
else
  podman run --name $PODNAME --publish=7474:7474 --publish=7687:7687 \
   --volume=$NEODIR/neodb:/data \
   --volume=$NEODIR/plugins:/plugins \
   --volume=$NEODIR/import:/var/lib/neo4j/import \
   --env 'NEO4J_PLUGINS=["apoc"]' \
   --env NEO4J_apoc_export_file_enabled=true \
   --env NEO4J_apoc_import_file_enabled=true \
   --env NEO4J_apoc_import_file_use__neo4j__config=true \
   --env NEO4J_dbms_security_procedures_unrestricted=apoc.* \
   --env NEO4J_AUTH=neo4j/passw0rd neo4j:5.26.2-community-ubi9

  # --env NEO4J_AUTH=none  or --env=NEO4J_AUTH=neo4j/neo4j
  # --env NEO4J_PLUGINS=["graph-data-science", "apoc", "apoc-extended"]
  # Note that the container may download the right version of plugin itself if not already done
fi
```

The Neo4j Browser console should be up on http://localhost:7474

For docs on usage of the image, see their Dockerhub entry at https://hub.docker.com/_/neo4j/ and look in github for helpful usage tips and bugs  https://github.com/neo4j/docker-neo4j/issues 

Note that some good docs on setting up APOC and enabling file export / import - in the context of also including an APOC extended plugin with even more specialized DB functions: https://github.com/neo4j-contrib/neo4j-apoc-procedures/blob/5.26.0/docs/asciidoc/modules/ROOT/partials/docker.adoc

There are several stories on origin of the name APOC - A Package of Components, Awesome Procedures on Cypher, or a character from The Matrix.  I prefer the one I first heard: A Pile Of Code
