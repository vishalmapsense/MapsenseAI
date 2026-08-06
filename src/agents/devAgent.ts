import { createADKAgent } from "./adkAgent";
import * as dotenv from "dotenv";
import path from "path";
//agent web run commond
//npx adk web src/agents/devAgent.ts --reload_agents

// Load .env.local to ensure environment variables are available for the ADK web server
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// createADKAgent returns the rootAgent synchronously
const { rootAgent } = createADKAgent();

export { rootAgent };
