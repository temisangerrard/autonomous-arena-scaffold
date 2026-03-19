import { Composition } from "remotion";
import { ArenaHype } from "./compositions/ArenaHype";

export const Root = () => (
  <Composition
    id="ArenaHype"
    component={ArenaHype}
    durationInFrames={1470}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{}}
  />
);
