import AgentPage from "../[id]/page";

export default function NewAgentPage() {
  return AgentPage({ params: Promise.resolve({ id: "new" }) });
}
