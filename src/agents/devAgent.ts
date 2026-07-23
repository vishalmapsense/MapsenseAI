import { createADKAgent } from "./adkAgent";
import * as dotenv from "dotenv";
import path from "path";

// Load .env.local to ensure environment variables are available for the ADK web server
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// createADKAgent will return the rootAgent.
const { rootAgent } = createADKAgent();

// ADK web CLI expects an export named 'rootAgent'
export { rootAgent };
