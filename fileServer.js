const { findFreePort } = require("./utils");
const http = require("http");
const fs = require("fs");

async function serveFile(file, port) {
  if (!port) port = await findFreePort();

  //serve file, shutdown server after first hit
  const server = http.createServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const readStream = fs.createReadStream(file);
    readStream.pipe(res);
    readStream.on("end", () => {
      server.close();
    });
  });
  server.listen(port);
  return port;
}

module.exports = {
  serveFile,
};
