const { spawn } = require("child_process");

const child = spawn("node", ["/Users/vishalkushwaha/Mapsense/Mapbox-MCP-server/mcp-server/dist/esm/index.js"]);

child.stdout.on("data", (data) => {
  const lines = data.toString().split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      console.log("Output from MCP:", JSON.stringify(msg, null, 2));
      if (msg.id === 1) {
        process.exit(0);
      }
    } catch(e) {}
  }
});

child.stderr.on("data", (data) => {
  console.error("Stderr:", data.toString());
});

const init = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" }
  }
};

const callTool = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "search_and_geocode_tool",
    arguments: { q: "Kanpur Zoological Park" }
  }
};

child.stdin.write(JSON.stringify(init) + "\n");
setTimeout(() => {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify(callTool) + "\n");
}, 1000);
