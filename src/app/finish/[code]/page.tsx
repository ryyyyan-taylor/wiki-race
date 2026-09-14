import { FinishView } from "./FinishView";

export default async function FinishPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <FinishView roomCode={code.toUpperCase()} />;
}
