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

module.exports = {
  prompt,
  yesOrNo,
  promisifyStream,
};
