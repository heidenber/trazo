// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Diagram } from "../model/index.js";
import type { Scene } from "../scene.js";
import { layoutArchitecture } from "./architecture.js";
import { layoutChen } from "./chen.js";
import { layoutErd } from "./erd.js";
import { addLegend } from "./legend.js";
import { layoutSequence } from "./sequence.js";
import { layoutWorkflow } from "./workflow.js";

async function layoutScene(diagram: Diagram): Promise<Scene> {
  if (diagram.type === "state") throw new Error("state diagrams have no layout yet");
  if (diagram.type === "chen") return layoutChen(diagram);
  if (diagram.type === "sequence") return layoutSequence(diagram);
  if (diagram.type === "erd") return layoutErd(diagram);
  return diagram.type === "workflow" ? layoutWorkflow(diagram) : layoutArchitecture(diagram);
}

/** Lays the diagram out, then adds the legend, the one step every type shares. */
export async function layoutDiagram(diagram: Diagram): Promise<Scene> {
  return addLegend(await layoutScene(diagram));
}
