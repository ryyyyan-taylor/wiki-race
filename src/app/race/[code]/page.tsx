import { getWikipediaStylesheetHrefs } from "@/lib/wiki";
import { RaceView } from "./RaceView";

export default async function RacePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const stylesheetHrefs = await getWikipediaStylesheetHrefs();

  return <RaceView roomCode={code.toUpperCase()} stylesheetHrefs={stylesheetHrefs} />;
}
