import packageJson from "../package.json";
import { StudioShell } from "@/components/studio-shell";

export default function Home() {
  return <StudioShell version={packageJson.version} />;
}
