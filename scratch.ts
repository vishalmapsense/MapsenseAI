import { InMemoryRunner, LlmAgent, Gemini } from "@google/adk";
import { createUserContent } from "@google/genai";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const model = new Gemini({ model: "gemini-3.1-flash-lite", apiKey: process.env.GEMINI_API_KEY });
const runner = new InMemoryRunner({
  agent: new LlmAgent({ name: "test_agent", instruction: "Say hello", model: model }),
});

async function main() {
  const session = await runner.sessionService.createSession({ appName: runner.appName, userId: "test" });
  for await (const event of runner.runAsync({
    userId: session.userId,
    sessionId: session.id,
    newMessage: createUserContent("hi"),
  })) {
    console.log("EVENT AUTHOR:", event.author);
    if (event.usageMetadata) {
        console.log("USAGE:", event.usageMetadata);
    }
  }
}
main();
