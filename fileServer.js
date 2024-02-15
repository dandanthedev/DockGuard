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

async function startRecieve(location) {
  const port = await findFreePort();

  //run http server that listens for POST requests. When a request is received, the server will save the file to the specified location
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      const writeStream = fs.createWriteStream(location);

      //pipe req body to file
      req.pipe(writeStream);

      req.on("end", () => {
        res.writeHead(200);
        res.end("file received");
      });

      writeStream.on("finish", () => {
        server.close();
      });

      writeStream.on("error", (err) => {
        console.error(err);
        server.close();
      });
    } else {
      res.writeHead(405);
      res.end(
        "You have stumbled upon the DockGuard uploading server. This server is used to pass the export file to DockGuard. This server should shut down automatically after the file is received."
      );
    }
  });

  server.listen(port);

  return port;
}

module.exports = {
  startRecieve,
  serveFile,
};
