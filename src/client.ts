import { AgentClient } from "agents/client";

const agent = new AgentClient({
  agent: "ReminderAgent",
  name: "elahe",
  host: window.location.host
});

console.log("Aether conectado:", agent);
