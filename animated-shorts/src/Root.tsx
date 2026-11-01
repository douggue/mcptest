import React from "react";
import { Composition } from "remotion";
import { BridgeShort, BRIDGE_FRAMES } from "./videos/bridge/Bridge";
import { ScorchShort, SCORCH_FRAMES } from "./videos/scorch/Scorch";
export const Root: React.FC = () => (
  <>
    <Composition id="BridgeShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="ScorchShort" component={ScorchShort} durationInFrames={SCORCH_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
