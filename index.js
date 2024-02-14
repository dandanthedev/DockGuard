#! /usr/bin/env node

require("dotenv").config();

const isUnattended = process.argv.includes("--unattended");

const { Docker } = require("node-docker-api");

const docker = new Docker({ socketPath: "//./pipe/docker_engine" });

const fs = require("fs");
const kleur = require("kleur");

const label = "dockguard";

let verbose = process.argv.includes("--verbose");
if (verbose) console.log(kleur.gray("🦆 Verbose mode enabled."));

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

const promisifyStream = (stream) =>
  new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => {
      resolve(data);
    });
    stream.on("error", reject);
  });

async function main() {
  if (!fs.existsSync("./dumps")) {
    fs.mkdirSync("./dumps");
  }

  console.log(kleur.gray("🦆 Looking for running databases..."));

  const list = await docker.container.list();

  const running = list.filter((c) => c.data.State === "running");

  let dbPorts = running.filter((c) =>
    c.data.Ports.some((p) => p.PrivatePort === 3306)
  );

  if (dbPorts.length === 0) {
    console.log(
      kleur.red(
        "🦆💤 I couldn't find any running databases. I'm going back to sleep."
      )
    );
    process.exit(0);
  }

  console.log(kleur.green("\n🦆 Found the following running databases:"));
  for (const container of dbPorts) {
    console.log(`    - ${container.data.Names[0]}\n`);
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
          `🦆 Do you want to backup ${container.data.Names[0]}? (y/N) `
        ))
      ) {
        dbPorts = dbPorts.filter((c) => c !== container);
      }
    }
  }

  for (const container of dbPorts) {
    console.log(`🦆 Backing up ${container.data.Names[0]}...`);

    let foundInEnv = [];

    let username =
      process.env[`${container.data.Names[0].replace("/", "")}_USER`];
    let password =
      process.env[`${container.data.Names[0].replace("/", "")}_PASSWORD`];

    if (username) foundInEnv.push("username");

    if (password) foundInEnv.push("password");

    if (!username || !password)
      console.log(
        kleur.yellow(
          `     ⚠️ I couldn't find credentials for ${container.data.Names[0]} in the environment variables. Please provide them manually.`
        )
      );

    if (!username && !isUnattended && !process.env.DOCKGUARD_DISABLE_AUTH)
      username = await prompt("     😃 Please enter the database username: ");

    if (!username)
      if (
        process.env.DOCKGUARD_DISABLE_AUTH ||
        (!username &&
          !password &&
          !isUnattended &&
          (await yesOrNo(
            `     Do you want to temporarily disable authentication to try to backup the database? (y/N)\n${kleur.red(
              "       THIS IS DANGEROUS! y/N "
            )}`
          )))
      ) {
        console.log(
          kleur.white("     🦆 Restarting mysqld with authchecks disabled")
        );

        //stop container
        console.log(kleur.gray("         Stopping container..."));
        await container.stop();

        //run shell with auth disabled
        console.log(kleur.gray("         Doing the old switcheroo..."));

        await container.start();
        const authDisabled = await container.exec
          .create({
            AttachStdout: true,
            AttachStderr: true,
            Cmd: ["mysqld", "--skip-grant-tables"],
          })
          .then((exec) => {
            return exec.start({ Detach: false });
          });

        if (verbose) console.log(authDisabled);

        console.log(
          kleur.gray(
            "         --skip-grant-tables injected. Waiting for database to start..."
          )
        );

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const exec = await container.exec
            .create({
              AttachStdout: true,
              AttachStderr: true,
              Cmd: ["mysql", "-e", "SELECT 1"],
            })
            .then((exec) => {
              return exec.start({ Detach: false });
            })
            .then((stream) => promisifyStream(stream));

          if (exec.includes("1")) {
            console.log(kleur.green("         🎉 Database is up and running!"));
            break;
          }
        }

        console.log(
          kleur.red(
            "     ⚠️  Authentication has been temporarily disabled. This script will attempt to auto-restart the container after the backup. If it fails, you will need to manually restart the container to re-enable authentication."
          )
        );
        username = "root";
        password = false;
      }

    if (!password && password !== false && !isUnattended)
      password = await prompt(
        "     🔑 Please enter the database password: ",
        true
      );

    if (
      !foundInEnv.length > 0 &&
      !isUnattended &&
      !(username === "root" && password === false) &&
      (await yesOrNo(
        "\n     Do you want to automagically ✨ append the missing credentials to the environment variables? (y/N) "
      ))
    ) {
      fs.appendFileSync(
        ".env",
        `\n${container.data.Names[0].replace(
          "/",
          ""
        )}_USER=${username}\n${container.data.Names[0].replace(
          "/",
          ""
        )}_PASSWORD=${password}\n`
      );
      console.log(
        kleur.green(
          `     🎉 Credentials for ${container.data.Names[0]} have been added to the environment variables.`
        )
      );
    }

    console.log(kleur.gray("     🦆 Running mysqldump..."));

    //rmysqldump --all-databases
    let exec = await container.exec
      .create({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ["mysqldump", "--all-databases", "-u", username, "-p" + password],
      })
      .then((exec) => {
        return exec.start({ Detach: false });
      })
      .then((stream) => promisifyStream(stream));

    if (verbose) console.log(exec);

    if (!exec.includes(`-- Dump completed on `)) {
      console.log(kleur.red("     🚫 Failed to dump database."));
      continue;
    }

    const dumpTime = new Date();

    //save raw dump to file
    fs.writeFileSync(
      `./dumps${container.data.Names[0]}-${dumpTime.getTime()}.sql`,
      exec
    );

    //trim all non alphanumeric characters, do allow spaces, newlines, - and tabs
    let execTrim = exec.replace(/[^a-zA-Z0-9\s\n\t-]/g, "");

    //trim first line if it includes Warning
    if (execTrim.split("\n")[0].includes("Warning"))
      execTrim = execTrim.split("\n").slice(1).join("\n");

    execTrim = `-- Dumped from ${
      container.data.Names[0]
    } by DockGuard at ${dumpTime.toISOString()}\n${execTrim}`;

    //save trimmed dump to file
    fs.writeFileSync(
      `./dumps/${container.data.Names[0]}-${dumpTime.getTime()}-trimmed.sql`,
      execTrim
    );

    //if auth was disabled, re-enable it
    if (username === "root" && password === false) {
      console.log(
        kleur.gray("     🦆 Restarting container to re-enable authchecks...")
      );
      await container.restart();
    }

    console.log(
      kleur.green(
        `     🎉 Backup of ${
          container.data.Names[0]
        } has been saved to ./dumps/${
          container.data.Names[0]
        }-${dumpTime.getTime()}-trimmed.sql`
      )
    );
  }

  console.log(kleur.green("\n🦆 Quack! All done!"));
}

main();
