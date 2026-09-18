import { getWikipediaStylesheetHrefs } from "@/lib/wiki";
import { FinishView } from "./FinishView";

export default async function FinishPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const stylesheetHrefs = await getWikipediaStylesheetHrefs();

  return <FinishView roomCode={code.toUpperCase()} stylesheetHrefs={stylesheetHrefs} />;
}
