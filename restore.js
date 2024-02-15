#! /usr/bin/env node

require("dotenv").config();

const isUnattended = process.argv.includes("--unattended");
const verbose = process.argv.includes("--verbose");

let stillExists = false;

//set last argument as the action
const action = process.argv[process.argv.length - 1];

const kleur = require("kleur");

if (action === "--restore") {
  console.log(
    kleur.red(
      "🦆 You need to provide the name of the container to restore the backup from"
    )
  );
  return;
}

const docker = require("./docker.js");

const { yesOrNo, supportedContainers, choose } = require("./utils.js");

const mysql = require("./engines/mysql.js");

const fs = require("fs");

async function main() {
  if (!fs.existsSync("./dumps")) {
    console.log(
      kleur.red(
        "🦆 I couldn't find a dumps folder. Please run the backup script first."
      )
    );
    process.exit(1);
  }

  const dbPorts = await supportedContainers(docker, verbose);

  const container = dbPorts.find(
    (c) => c.data.data.Names[0].replace("/", "") === action
  );

  if (container) stillExists = true;

  //recursively search dumps folder for files
  const files = [];
  const walk = async (dir) => {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const path = `${dir}/${file}`;
      const stat = fs.statSync(path);
      if (stat && stat.isDirectory()) {
        await walk(path);
      } else {
        files.push(path);
      }

      if (file === list[list.length - 1]) {
        return;
      }
    }
  };
  await walk("./dumps");

  //find dumps for the container
  const containerFiles = files.filter((f) =>
    f.includes(container?.data?.data?.Names[0])
  );

  if (containerFiles.length === 0) {
    console.log(
      kleur.red(
        `🦆 I couldn't find any dumps for ${container?.data?.data?.Names[0]}. Try starting the container.`
      )
    );
    process.exit(1);
  }

  console.log(kleur.gray("🦆 What would you like to do?"));

  const options = ["Restore to a new container"];

  if (stillExists) options.push("Restore to the original container");

  let choice;
  if (options.length > 1) {
    choice = await choose(options);
  } else {
    choice = options[0];
  }

  const newContainer = choice === "Restore to a new container";

  if (!newContainer) {
    console.log(
      kleur.red(
        "Please ensure that the original container is empty, as no data will be deleted."
      )
    );
  }

  if (container.type === "mysql") {
    if (
      !(await mysql.runRestore(
        container.data,
        isUnattended,
        verbose,
        newContainer
      ))
    ) {
      process.exit(1);
    }
  }

  console.log(kleur.green(`🦆 Your database is ready to rock 🪨`));
}

main();
