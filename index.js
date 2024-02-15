#! /usr/bin/env node

require("dotenv").config();

const isUnattended = process.argv.includes("--unattended");

const docker = require("./docker.js");

const fs = require("fs");
const kleur = require("kleur");

const label = "dockguard";

const { yesOrNo } = require("./utils.js");

const mysql = require("./engines/mysql.js");

let verbose = process.argv.includes("--verbose");
if (verbose) console.log(kleur.gray("🦆 Verbose mode enabled."));

async function main() {
  if (!fs.existsSync("./dumps")) {
    fs.mkdirSync("./dumps");
  }

  //load all engines
  const engines = fs.readdirSync("./engines").map((f) => f.split(".")[0]);

  console.log(kleur.gray("🦆 Looking for supported containers"));

  const list = await docker.container.list();

  const running = list.filter((c) => c.data.State === "running");

  const dbPorts = [];

  //loop through all engines
  for (const engine of engines) {
    const engineModule = require(`./engines/${engine}`);
    const runningDatabases = await engineModule.detectRunning(running);
    dbPorts.push(...runningDatabases.map((c) => ({ type: engine, data: c })));
  }

  console.log(kleur.green("\n🦆 Found the following running services:"));
  for (const container of dbPorts) {
    //convert all container data to regular objects

    console.log(`    - ${container.data.data.Names[0]} (${container.type})`);
  }

  //check if .env file exists
  if (!fs.existsSync(".env")) {
    console.log(
      kleur.yellow(`🦆 I couldn't find a .env file. I will create one for you.`)
    );
    fs.writeFileSync(".env", "");
  }

  //ask which databases to backup
  if (!isUnattended) {
    for (const container of dbPorts) {
      if (
        !(await yesOrNo(
          `🦆 Do you want to backup ${container.data.data.Names[0]}? (y/N) `
        ))
      ) {
        dbPorts = dbPorts.filter((c) => c !== container);
      }
    }
  }

  for (const container of dbPorts) {
    console.log(`🦆 Backing up ${container.data.data.Names[0]}...`);

    if (container.type === "mysql")
      if (!(await mysql.runExport(container.data, isUnattended, verbose))) {
        console.log(
          kleur.red(`🦆 Failed to backup ${container.data.data.Names[0]}.`)
        );
        continue;
      }
  }

  console.log(kleur.green("\n🦆 Quack! All done!"));
}

main();
