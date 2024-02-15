const { Docker } = require("node-docker-api");

const docker = new Docker({ socketPath: "//./pipe/docker_engine" });

module.exports = docker;
