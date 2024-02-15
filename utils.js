const fs = require("fs");

async function prompt(question, password = false) {
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promise = new Promise((resolve) => {
    readline.question(question, (answer) => {
      if (password) readline.close();
      resolve(answer);
    });
  });

  if (password)
    readline._writeToOutput = function _writeToOutput(stringToWrite) {
      readline.output.write("*");
    };

  const result = await promise;

  readline.close();

  return result;
}
async function yesOrNo(question) {
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promise = new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });

  const result = await promise;

  return result.toLowerCase().startsWith("y");
}
const promisifyStream = (stream, send = "") => {
  return new Promise((resolve) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk.toString();
    });
    stream.on("end", () => {
      resolve(data);
    });
    if (send) stream.write(send);
  });
};

async function supportedContainers(docker) {
  //load all engines
  const engines = fs.readdirSync("./engines").map((f) => f.split(".")[0]);

  const list = await docker.container.list();

  const running = list.filter((c) => c.data.State === "running");

  const dbPorts = [];

  //loop through all engines
  for (const engine of engines) {
    const engineModule = require(`./engines/${engine}`);
    const runningDatabases = await engineModule.detectRunning(running);
    dbPorts.push(...runningDatabases.map((c) => ({ type: engine, data: c })));
  }

  return dbPorts;
}
async function choose(options) {
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promise = new Promise((resolve) => {
    readline.question(
      options.map((o, i) => `${i + 1}. ${o}`).join("\n") + "\n",
      (answer) => {
        readline.close();
        resolve(answer);
      }
    );
  });

  const result = await promise;

  return options[result - 1];
}
function randomString(length) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function findFreePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

module.exports = {
  prompt,
  yesOrNo,
  promisifyStream,
  supportedContainers,
  choose,
  randomString,
  findFreePort,
};
