import { createADKAgent } from "./adkAgent";
import * as dotenv from "dotenv";
import path from "path";

// Load .env.local to ensure environment variables are available for the ADK web server
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// createADKAgent is now async, so we resolve it and export the rootAgent.
let rootAgent: any;

const init = async () => {
  const result = await createADKAgent();
  rootAgent = result.rootAgent;
};

// Start initialization immediately
const initPromise = init();

export { rootAgent, initPromise };
