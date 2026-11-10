import React from "react";
import { Composition } from "remotion";
import { BridgeShort, BRIDGE_FRAMES } from "./videos/bridge/Bridge";
import { ScorchShort, SCORCH_FRAMES } from "./videos/scorch/Scorch";
import { EmuShort, EMU_FRAMES } from "./videos/emu/Emu";
import { Scorch2Short, SCORCH2_FRAMES } from "./videos/scorch2/Scorch2";
import { PisaShort, PISA_FRAMES } from "./videos/pisa/Pisa";
export const Root: React.FC = () => (
  <>
    <Composition id="BridgeShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="PisaShort" component={PisaShort} durationInFrames={PISA_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="Scorch2Short" component={Scorch2Short} durationInFrames={SCORCH2_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="EmuShort" component={EmuShort} durationInFrames={EMU_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="ScorchShort" component={ScorchShort} durationInFrames={SCORCH_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
