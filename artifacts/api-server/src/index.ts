import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachOverworldSocket } from "./lib/overworldSocket";
import { attachCoopSocket } from "./lib/coopSocket";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Use an explicit HTTP server so a WebSocket server can share the same port.
const server = createServer(app);
attachOverworldSocket(server);
attachCoopSocket(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
