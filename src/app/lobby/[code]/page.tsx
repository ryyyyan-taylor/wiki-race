import { LobbyView } from "./LobbyView";

export default async function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <LobbyView roomCode={code.toUpperCase()} />;
}
