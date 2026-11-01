import React from "react";
import { Composition } from "remotion";
import { Smoke } from "./Smoke";

export const RemotionRoot: React.FC = () => (
  <Composition id="Smoke" component={Smoke} durationInFrames={90} fps={30} width={640} height={360} defaultProps={{ title: "Smoke test" }} />
);
