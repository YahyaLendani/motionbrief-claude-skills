import React from "react";
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

const Root: React.FC = () => {
  return <RemotionRoot />;
};

registerRoot(Root);
