const fs = require("fs");
const {
  prompt,
  yesOrNo,
  promisifyStream,
  randomString,
} = require("../utils.js");
const { serveFile, closeServer, startRecieve } = require("../fileServer.js");
const kleur = require("kleur");

const docker = require("../docker.js");

async function disableAuthChecks(container, verbose = false) {
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
}

async function detectRunning(containers) {
  return containers.filter((c) =>
    c.data.Ports.some((p) => p.PrivatePort === 3306)
  );
}

async function runExport(container, isUnattended, verbose) {
  if (!fs.existsSync("./dumps/mysql"))
    fs.mkdirSync("./dumps/mysql", { recursive: true });

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
      const res = await disableAuthChecks(container);
      // if (!res) return false; //TODO: error handling
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

  console.log(kleur.gray("     🦆 Checking if authentication is valid..."));
  const exec = await container.exec
    .create({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ["mysql", "-u", username, "-p" + password, "-e", "SELECT 1"],
    })
    .then((exec) => {
      return exec.start({ Detach: false });
    })
    .then((stream) => promisifyStream(stream));

  if (exec.includes("ERROR")) {
    console.log(
      kleur.red(
        "     ⚠️ Authentication failed. Please provide valid credentials."
      )
    );
    return false;
  }

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

  //Webserver
  console.log(kleur.gray("     🦆 Starting webserver..."));

  const dumpTime = new Date();

  const port = await startRecieve(
    `./dumps/mysql/${container.data.Names[0]}-${dumpTime.getTime()}.sql`
  );

  console.log(kleur.gray("     🦆 Running mysqldump..."));

  //rmysqldump --all-databases
  let dumpExec = await container.exec
    .create({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        "sh",
        "-c",
        `mysqldump -u ${username} -p${password} --all-databases > /tmp/dockguard.sql`,
      ],
    })
    .then((exec) => {
      return exec.start({ Detach: false });
    })
    .then((stream) => promisifyStream(stream));

  if (verbose) console.log(dumpExec);

  console.log(kleur.gray("     🦆 Sending dump to webserver..."));

  //send post request to webserver
  const sendExec = await container.exec
    .create({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        "sh",
        "-c",
        `curl -X POST -d @/tmp/dockguard.sql http://host.docker.internal:${port}/`,
      ],
    })
    .then((exec) => {
      return exec.start({ Detach: false });
    })
    .then((stream) => promisifyStream(stream));

  if (verbose) console.log(sendExec);

  console.log(kleur.gray("     🦆 Cleaning up..."));
  await container.exec
    .create({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ["sh", "-c", `rm /tmp/dockguard.sql`],
    })
    .then((exec) => {
      return exec.start({ Detach: false });
    });

  console.log(kleur.gray("     🦆 Checking if dump has been created"));

  if (
    !fs.existsSync(
      `./dumps/mysql/${container.data.Names[0]}-${dumpTime.getTime()}.sql`
    ) ||
    fs.statSync(
      `./dumps/mysql/${container.data.Names[0]}-${dumpTime.getTime()}.sql`
    ).size < 1
  ) {
    console.log(
      kleur.red(
        "     ⚠️ I couldn't find the dump file. Something went wrong during the process."
      )
    );
    return false;
  }

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
      } has been saved to ./dumps/mysql/${
        container.data.Names[0]
      }-${dumpTime.getTime()}.sql`
    )
  );

  return true;
}

async function runRestore(container, isUnattended, verbose, newContainer) {
  const backups = fs.readdirSync("./dumps/mysql");
  const backupsForContainer = backups.filter((b) =>
    b.includes(container.data.Names[0].replace("/", ""))
  );

  //hacky fix
  const trimmedBackups = backupsForContainer;

  if (trimmedBackups.length < 1) {
    console.log(
      kleur.red(
        `🦆 I couldn't find any trimmed backups for ${container.data.Names[0]}.`
      )
    );
    process.exit(1);
  }

  let selectedBackup = trimmedBackups[0];

  if (trimmedBackups.length > 1) {
    console.log(kleur.gray("🦆 Which backup would you like to restore?"));

    selectedBackup = await choose(trimmedBackups);
  }

  let password;
  let username;

  if (newContainer) {
    password = randomString(32);
    username = "root";

    console.log(kleur.gray("🦆 Creating new container..."));
    container = await docker.container.create({
      Image: "mysql:latest",
      name: "dockguard-restore-" + randomString(8),
      Env: [`MYSQL_ROOT_PASSWORD=${password}`],
    });
    console.log(
      kleur.green(
        `🦆 New container created: ${container.id}. Root password: ${password}`
      )
    );
  }

  if (!username && !isUnattended) {
    username = await prompt("🦆 Please enter the database username: ");
    if (
      !username &&
      !isUnattended &&
      (await yesOrNo(
        `🦆 Do you want to automagically & temporarily disable authentication? ${kleur.red(
          "WARNING, THIS IS DANGEROUS! "
        )}`
      ))
    ) {
      await disableAuthChecks(container, verbose);
      username = "root";
      password = false;
    }
  }

  if (!password && password !== false && !isUnattended)
    password = await prompt("🦆 Please enter the database password: ", true);

  if (!password && password !== false)
    console.log(
      kleur.red(
        "🦆 I couldn't find a password for the database. Please provide one."
      )
    );

  if (
    !(await yesOrNo(
      `🦆 Are you sure you want to restore the database? ${kleur.red(
        "THIS WILL DELETE EVERYTHING CURRENTLY IN THE DATABASE!"
      )}`
    ))
  )
    return;

  //ensure the container is running
  console.log(kleur.gray("\n🦆 Starting container..."));
  await container.start();

  //wait untill the database is up and running
  console.log(kleur.gray("🦆 Waiting for database to start..."));
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
      console.log(kleur.green("🎉 Database is up and running!"));
      break;
    }
  }

  //if database was created by us, wait untill the user has been created
  if (newContainer) {
    console.log(kleur.gray("🦆 Waiting for root user to be created..."));
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const exec = await container.exec
        .create({
          AttachStdout: true,
          AttachStderr: true,
          Cmd: ["mysql", "-u", username, "-p" + password, "-e", "SELECT 1"],
        })
        .then((exec) => {
          return exec.start({ Detach: false });
        })
        .then((stream) => promisifyStream(stream));

      if (!exec.includes("ERROR")) {
        console.log(kleur.green("🎉 Root user is created!"));
        break;
      }
    }
  }

  console.log(kleur.gray("🦆 Spinning up webserver"));

  const port = await serveFile(`./dumps/mysql/${selectedBackup}`);

  console.log(
    kleur.gray(`🦆 Backup is listening on ${port}/backup.sql. Restoring...`)
  );

  const internalIp = "host.docker.internal";
  //restore backup
  let exec = await container.exec
    .create({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        "sh",
        "-c",
        `curl -s http://${internalIp}:${port}/backup.sql | mysql -u ${username} -p${password} --binary-mode`,
      ],
    })
    .then((exec) => {
      return exec.start({ Detach: false });
    })
    .then((stream) => promisifyStream(stream));

  if (verbose) console.log(exec);

  if (exec.includes("ERROR")) {
    console.log(
      kleur.red(
        "🦆 Failed to restore database. The webserver might not have been reachable from within the docker container, or the backup file could have been malformed. Use --verbose for more info."
      )
    );
    return false;
  }

  return true;
}

module.exports = {
  runExport,
  detectRunning,
  runRestore,
};
