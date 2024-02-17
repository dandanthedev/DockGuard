const { Docker } = require("node-docker-api");
const fs = require("fs");
//find socketpath
let socketPath;
if (fs.existsSync("//./pipe/docker_engine")) {
  socketPath = "//./pipe/docker_engine";
} else if (fs.existsSync("/var/run/docker.sock")) {
  socketPath = "/var/run/docker.sock";
} else {
  console.log(
    "🦆 I couldn't find a docker socket. Please make sure docker is installed and running."
  );
  process.exit(1);
}

const docker = new Docker({ socketPath });

module.exports = docker;
