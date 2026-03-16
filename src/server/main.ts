#!/usr/bin/env node
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import type { CliOptions } from "./core/platform/services/CcvOptionsService";
import { startServer } from "./startServer";

const program = new Command();

program
  .name(packageJson.name)
  .version(packageJson.version)
  .description(packageJson.description);

// start server
program
  .option("-p, --port <port>", "port to listen on")
  .option("-h, --hostname <hostname>", "hostname to listen on")
  .option("-P, --password <password>", "password to authenticate")
  .action(async (options: CliOptions) => {
    await startServer(options);
  });

/* Other Commands Here */

const main = async () => {
  program.parse(process.argv);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
